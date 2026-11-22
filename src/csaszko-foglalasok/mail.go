package main

// Minimal SMTP sending. Gmail: host smtp.gmail.com, port 465, secure (TLS),
// user = Gmail address, pass = a 16-character Google "app password".

import (
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/smtp"
	"net/textproto"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

type Attachment struct {
	Filename    string
	ContentType string
	Content     string
}

type Mail struct {
	From, FromName, To, ReplyTo string
	Subject, Text, HTML         string
	Attachments                 []Attachment
}

var reCRLF = regexp.MustCompile(`[\r\n]+`)

func clean(s string) string { return strings.TrimSpace(reCRLF.ReplaceAllString(s, " ")) }
func b64(s string) string   { return base64.StdEncoding.EncodeToString([]byte(s)) }
func wrap76(s string) string {
	var b strings.Builder
	for len(s) > 76 {
		b.WriteString(s[:76] + "\r\n")
		s = s[76:]
	}
	if s != "" {
		b.WriteString(s + "\r\n")
	}
	return b.String()
}

// encodeHeader: RFC 2047 encoded words, split so each stays short.
func encodeHeader(v string) string {
	v = clean(v)
	ascii := true
	for _, r := range v {
		if r < 0x20 || r > 0x7e {
			ascii = false
			break
		}
	}
	if ascii {
		return v
	}
	var parts []string
	cur := ""
	for _, r := range v {
		if len(cur)+utf8.RuneLen(r) > 42 {
			parts = append(parts, cur)
			cur = ""
		}
		cur += string(r)
	}
	if cur != "" {
		parts = append(parts, cur)
	}
	for i, p := range parts {
		parts[i] = "=?UTF-8?B?" + b64(p) + "?="
	}
	return strings.Join(parts, "\r\n ")
}

func addr(email, name string) string {
	email = clean(email)
	if name != "" {
		return encodeHeader(name) + " <" + email + ">"
	}
	return "<" + email + ">"
}

func buildMessage(m *Mail) string {
	id := randHex(9)
	domain := "localhost"
	if i := strings.LastIndex(clean(m.From), "@"); i >= 0 {
		domain = clean(m.From)[i+1:]
	}
	alt, mix := "alt-"+id, "mix-"+id
	head := []string{
		"From: " + addr(m.From, m.FromName),
		"To: " + addr(m.To, ""),
	}
	if m.ReplyTo != "" {
		head = append(head, "Reply-To: "+addr(m.ReplyTo, ""))
	}
	head = append(head,
		"Subject: "+encodeHeader(m.Subject),
		"Date: "+time.Now().UTC().Format("Mon, 02 Jan 2006 15:04:05 +0000"),
		fmt.Sprintf("Message-ID: <%s.%d@%s>", id, time.Now().UnixMilli(), domain),
		"MIME-Version: 1.0",
	)
	altBody := "--" + alt + "\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" + wrap76(b64(m.Text)) +
		"--" + alt + "\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" + wrap76(b64(m.HTML)) +
		"--" + alt + "--\r\n"
	if len(m.Attachments) == 0 {
		head = append(head, `Content-Type: multipart/alternative; boundary="`+alt+`"`)
		return strings.Join(head, "\r\n") + "\r\n\r\n" + altBody
	}
	head = append(head, `Content-Type: multipart/mixed; boundary="`+mix+`"`)
	body := "--" + mix + "\r\nContent-Type: multipart/alternative; boundary=\"" + alt + "\"\r\n\r\n" + altBody
	for _, a := range m.Attachments {
		name := strings.ReplaceAll(clean(a.Filename), `"`, "")
		body += "--" + mix + "\r\nContent-Type: " + a.ContentType + `; name="` + name + "\"\r\n" +
			`Content-Disposition: attachment; filename="` + name + "\"\r\nContent-Transfer-Encoding: base64\r\n\r\n" + wrap76(b64(a.Content))
	}
	body += "--" + mix + "--\r\n"
	return strings.Join(head, "\r\n") + "\r\n\r\n" + body
}

func sendMail(cfg SMTPConf, m *Mail) error {
	if cfg.Host == "" || cfg.User == "" || cfg.Pass == "" {
		return errors.New("Az e-mail küldés nincs beállítva.")
	}
	if m.To == "" {
		return errors.New("nincs címzett")
	}
	hostPort := net.JoinHostPort(cfg.Host, fmt.Sprint(cfg.Port))
	dialer := &net.Dialer{Timeout: 15 * time.Second}
	var conn net.Conn
	var err error
	if cfg.Secure {
		conn, err = tls.DialWithDialer(dialer, "tcp", hostPort, &tls.Config{ServerName: cfg.Host})
	} else {
		conn, err = dialer.Dial("tcp", hostPort)
	}
	if err != nil {
		return err
	}
	conn.SetDeadline(time.Now().Add(30 * time.Second))
	c, err := smtp.NewClient(conn, cfg.Host)
	if err != nil {
		conn.Close()
		return err
	}
	defer c.Close()
	if err := c.Hello("csaszko.local"); err != nil {
		return err
	}
	if !cfg.Secure {
		if ok, _ := c.Extension("STARTTLS"); ok {
			if err := c.StartTLS(&tls.Config{ServerName: cfg.Host}); err != nil {
				return err
			}
		}
	}
	if err := c.Auth(smtp.PlainAuth("", cfg.User, cfg.Pass, cfg.Host)); err != nil {
		return err
	}
	if err := c.Mail(clean(m.From)); err != nil {
		return err
	}
	if err := c.Rcpt(clean(m.To)); err != nil {
		return err
	}
	wc, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := wc.Write([]byte(buildMessage(m))); err != nil {
		return err
	}
	if err := wc.Close(); err != nil {
		return err
	}
	return c.Quit()
}

// explainMail turns an SMTP error into a short Hungarian explanation for the admin screen.
func explainMail(err error) string {
	var te *textproto.Error
	if errors.As(err, &te) {
		switch {
		case te.Code == 535:
			return "A Gmail nem fogadta el a belépést – ellenőrizd az e-mail címet és az alkalmazásjelszót. (Gmail: " + cut(te.Msg, 90) + ")"
		case te.Code >= 550 && te.Code <= 554:
			return "A címzett e-mail címe nem létezik vagy elutasította a levelet."
		}
	}
	msg := err.Error()
	var dnsErr *net.DNSError
	switch {
	case errors.As(err, &dnsErr):
		return "Nem érhető el a levelezőszerver (nincs internet vagy hibás szervernév)."
	case strings.Contains(msg, "refused") || strings.Contains(msg, "timeout") || strings.Contains(msg, "i/o timeout"):
		return "A levelezőszerver nem válaszol – próbáld újra később."
	case strings.Contains(msg, "Username and Password not accepted") || strings.Contains(msg, "BadCredentials"):
		return "A Gmail nem fogadta el a belépést – ellenőrizd az e-mail címet és az alkalmazásjelszót."
	}
	return cut(msg, 200)
}
