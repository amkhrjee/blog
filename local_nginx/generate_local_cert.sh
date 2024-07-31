openssl req -x509 -out fullchain.pem -keyout privkey.pem \
  -newkey rsa:2048 -nodes -sha256 \
  -subj '/CN=localhost' \
  -addext "subjectAltName=DNS:localhost" \
  -addext "keyUsage=digitalSignature" \
  -addext "extendedKeyUsage=serverAuth"
