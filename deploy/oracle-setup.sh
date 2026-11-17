#!/usr/bin/env bash
# Run on a fresh Oracle Cloud Always Free VM (Ubuntu 22.04/24.04, Arm or x86):
#   curl -fsSL https://raw.githubusercontent.com/vishwajitr/learningmodel/<branch>/deploy/oracle-setup.sh | bash
# or copy the repo and run:  bash deploy/oracle-setup.sh
set -euo pipefail

REPO="${REPO:-https://github.com/vishwajitr/learningmodel.git}"
BRANCH="${BRANCH:-claude/cool-ptolemy-a0mwkk}"
DIR="${DIR:-$HOME/sensex_expiry_ai}"

# 1. Docker + compose plugin
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

# 2. Timezone (the scheduler uses IST)
sudo timedatectl set-timezone Asia/Kolkata || true

# 3. Code
if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch origin "$BRANCH" && git -C "$DIR" checkout "$BRANCH" && git -C "$DIR" pull --ff-only
else git clone --branch "$BRANCH" "$REPO" "$DIR"; fi
cd "$DIR"

# 4. Config
if [ ! -f .env ]; then
  cp .env.example .env
  echo
  echo ">>> Edit $DIR/.env now (ANTHROPIC_API_KEY, TELEGRAM_*, OPENALGO_*), then run:"
  echo "    cd $DIR && sudo docker compose up -d --build"
  exit 0
fi

# 5. Start (restart: unless-stopped brings it back after VM reboots)
sudo docker compose up -d --build
sudo docker compose logs --tail 20
