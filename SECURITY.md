# Security Policy

## Reporting a vulnerability

Open a [private security advisory](https://github.com/jatauabdullah-maker/kaze/security/advisories/new)
rather than a public issue. Include what you did, what happened, and what you
expected. I aim to reply within a week.

Please don't test against anyone else's machine.

## Threat model

Kaze is local-first. There is no Kaze backend, no account system, and no
telemetry. Two components are worth understanding if you're auditing:

**`server/server.py`** binds `127.0.0.1:8619` only. It is never exposed to the
network. The important subtlety: *any* website you visit can still send requests
to loopback from your browser. Reflecting `Access-Control-Allow-Origin` only
controls whether an attacker can read the response - the request still executes.
So state-changing endpoints (`POST /inspect`, `POST /jobs`, `DELETE /...`)
validate `Origin` explicitly and reject unknown or absent origins.

`Access-Control-Allow-Private-Network: true` is sent deliberately. Chrome's
Private Network Access preflight requires it for the hosted UI to reach
loopback. It does not widen who may call the server; the origin check does that.

File deletion (`DELETE /history/<id>?file=1`) resolves the real path and confirms
it sits inside the downloads directory before unlinking. Prefix string matching
is not sufficient here and is not used.

**`anime/`** is a Chrome extension that runs entirely in the browser. It requests
broad optional host permissions because the user chooses arbitrary source sites
at runtime; these are requested on demand, not granted up front. It writes files
through the File System Access API to a directory the user picks explicitly.

## Out of scope

- Anything requiring the attacker to already have local code execution or an
  interactive session on the machine.
- The behaviour of `yt-dlp`, `ffmpeg`, or the third-party media sites Kaze talks
  to. Report those upstream.
- Rate limits or blocks imposed by source sites.

## Supported versions

The latest release only. Kaze depends on scraping sites that change without
warning, so older versions stop working rather than being patched.
