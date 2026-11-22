// Csaszko Foglalások – data types (Service, Booking, Block, Settings…) and their default values.

package main

import (
	_ "time/tzdata"
)

/* ---------------------------------------------------------------- types */

type Service struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Note    string `json:"note"`
	Minutes int    `json:"minutes"`
	Price   *int   `json:"price"`
}

type BService struct {
	ID    string `json:"id"`
	Hu    string `json:"hu"`
	Price *int   `json:"price"`
}

type MailRec struct {
	Kind  string `json:"kind"`
	At    string `json:"at"`
	OK    bool   `json:"ok"`
	Error string `json:"error"`
}

type Booking struct {
	ID        string   `json:"id"`
	Status    string   `json:"status"` // pending | confirmed | declined | cancelled
	Source    string   `json:"source"` // web | manual
	Date      string   `json:"date"`
	Time      string   `json:"time"`
	Minutes   int      `json:"minutes"`
	Service   BService `json:"service"`
	Note      string   `json:"note"`
	Name      string   `json:"name"`
	Phone     string   `json:"phone"`
	Email     string   `json:"email"`
	CreatedAt string   `json:"createdAt"`
	UpdatedAt string   `json:"updatedAt,omitempty"`
	Message   string   `json:"message,omitempty"`
	Mail      *MailRec `json:"mail,omitempty"`
}

type Block struct {
	ID        string `json:"id"`
	Date      string `json:"date"`
	DateTo    string `json:"dateTo"`
	AllDay    bool   `json:"allDay"`
	From      string `json:"from"`
	To        string `json:"to"`
	Note      string `json:"note"`
	CreatedAt string `json:"createdAt"`
}

type DB struct {
	Bookings []*Booking `json:"bookings"`
	Blocks   []*Block   `json:"blocks"`
}

type SMTPConf struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Secure   bool   `json:"secure"`
	User     string `json:"user"`
	Pass     string `json:"pass"`
	FromName string `json:"fromName"`
}

type Remote struct {
	Hash  string `json:"hash,omitempty"`
	Salt  string `json:"salt,omitempty"`
	Ver   int    `json:"ver"`
	SetAt string `json:"setAt,omitempty"`
}

type Settings struct {
	// JS weekday keys: "0" = vasárnap … "6" = szombat. null = zárva. The second time is the LAST START.
	Hours            map[string][]string `json:"hours"`
	StepMinutes      int                 `json:"stepMinutes"`
	BufferMinutes    int                 `json:"bufferMinutes"`
	MinNoticeMinutes int                 `json:"minNoticeMinutes"`
	HorizonDays      int                 `json:"horizonDays"`
	AutoConfirm      bool                `json:"autoConfirm"`
	SameDay          bool                `json:"sameDay"` // false: the website books from tomorrow on
	Services         []Service           `json:"services"`
	SMTP             SMTPConf            `json:"smtp"`
	NotifyEmail      string              `json:"notifyEmail"`
	NtfyURL          string              `json:"ntfyUrl"`
	AdminURL         string              `json:"adminUrl"`
	SiteURL          string              `json:"siteUrl"`
	Secret           string              `json:"secret"`
	Remote           *Remote             `json:"remote,omitempty"`
	IGToken          string              `json:"igToken,omitempty"`       // Instagram long-lived access token
	IGUser           string              `json:"igUser,omitempty"`        // Instagram name for the profile link
	IGRefreshedAt    string              `json:"igRefreshedAt,omitempty"` // when the token was saved or last refreshed
}

func ip(n int) *int { return &n }

func defaultServices() []Service {
	return []Service{
		{ID: "haj", Name: "Hajvágás", Minutes: 40, Price: ip(3500)},
		{ID: "rovid", Name: "Rövid hajvágás", Minutes: 20, Price: ip(3500)},
		{ID: "hajszakall", Name: "Haj + szakáll", Minutes: 50, Price: ip(5500)},
		{ID: "szakall", Name: "Szakálligazítás", Minutes: 20, Price: ip(2000)},
		{ID: "gyerek", Name: "Gyerek hajvágás", Note: "13 éves korig", Minutes: 30, Price: ip(3000)},
	}
}

func defaultSettings() *Settings {
	open := []string{"15:00", "21:00"}
	return &Settings{
		Hours:            map[string][]string{"0": open, "1": nil, "2": open, "3": open, "4": open, "5": open, "6": open},
		StepMinutes:      20,
		MinNoticeMinutes: 30,
		HorizonDays:      30,
		Services:         defaultServices(),
		SMTP:             SMTPConf{Host: "smtp.gmail.com", Port: 465, Secure: true, FromName: "Csaszko Barbershop"},
		NotifyEmail:      "csaszarb666@gmail.com",
		SiteURL:          "https://csaszko.admcore.hu",
	}
}
