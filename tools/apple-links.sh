#!/bin/sh
# Probe how tv.apple.com handles links with and without a country and a slug.
ID=umc.cmc.ok1wgk0b9r737volhycpv9it
out=""
for u in "https://tv.apple.com/movie/$ID" "https://tv.apple.com/gb/movie/$ID" "https://tv.apple.com/us/movie/$ID" "https://tv.apple.com/movie/goldfinger/$ID" "https://tv.apple.com/de/movie/$ID"; do
  r=$(curl -s -o /tmp/p.html -w "%{http_code} %{redirect_url}" -A "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" "$u")
  t=$(grep -o '<title>[^<]*' /tmp/p.html | head -1 | sed 's/<title>//')
  out="$out%0A$u => $r | $t"
done
echo "::notice title=Apple links::$out"
