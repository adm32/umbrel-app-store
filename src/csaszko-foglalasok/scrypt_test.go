package main

import (
	"encoding/hex"
	"os"
	"testing"
)

func TestScryptRFC(t *testing.T) {
	k, _ := scryptKey([]byte("password"), []byte("NaCl"), 1024, 8, 16, 64)
	want := "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640"
	if hex.EncodeToString(k) != want {
		t.Fatalf("rfc vector mismatch: %x", k)
	}
}

func TestScryptNode(t *testing.T) {
	want := os.Getenv("NODE_SCRYPT")
	if want == "" {
		t.Skip()
	}
	k, _ := scryptKey([]byte("friss fade minden pénteken"), []byte("0123456789abcdef0123456789abcdef"), 16384, 8, 1, 64)
	if hex.EncodeToString(k) != want {
		t.Fatalf("node mismatch: %x", k)
	}
}
