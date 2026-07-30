#!/bin/bash
set -e
cd /home/ubuntu/stocktrack
git pull origin main
cd backend
.venv/bin/pip install -q -r requirements.txt
sudo /usr/bin/systemctl restart stocktrack
