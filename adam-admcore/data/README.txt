This folder is not overwritten by app updates.

outbox.json   requests waiting to be handed to the core Irányítópult app (normally empty)
stats.json    daily visitor counts (no personal data)
config.json   remaining launch-discount places (set from the Irányítópult)

Optional fallback: if the Irányítópult can't be reached, a push notification is sent
to the ntfy topic URL in a file called ntfy-url.txt in this folder, for example:
  https://ntfy.sh/admcore-7f3k9q2x8m1v
Never commit ntfy-url.txt to GitHub.
