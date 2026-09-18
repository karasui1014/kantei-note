#!/bin/bash
# AI鑑定ノートを、この Mac の中だけで開いて確かめる（ブラウザで http://localhost:8962 ）
cd "$(dirname "$0")"
open "http://localhost:8962" &
python3 -m http.server 8962
