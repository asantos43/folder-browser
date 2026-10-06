# The tools that build the release files (scripts/release-local.mjs; docs/RELEASING.md), so that the computer needs only Docker:
#   Node 24 (as the CI had), wine (electron-builder puts the icon and the version in the .exe through rcedit, and runs the 32-bit installer stub to make the
#   uninstaller: that needs wine32 too) and rpm (the .rpm), fpm's own needs.
FROM node:24-bookworm
ENV DEBIAN_FRONTEND=noninteractive \
    WINEDEBUG=-all \
    WINEDLLOVERRIDES="mscoree,mshtml=" \
    WINEPREFIX=/root/.wine \
    ELECTRON_BUILDER_CACHE=/root/.cache/electron-builder
RUN dpkg --add-architecture i386 \
 && apt-get update \
 && apt-get install -y --no-install-recommends wine wine64 wine32:i386 xvfb xauth rpm fakeroot dpkg-dev libarchive-tools zip unzip xz-utils bzip2 ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /work
