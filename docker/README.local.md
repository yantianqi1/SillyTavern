# Local Docker Deployment

This project is deployed through Docker only.

Persistent runtime data is mapped from these host directories:

- `docker/config` -> `/home/node/app/config`
- `docker/data` -> `/home/node/app/data`
- `docker/plugins` -> `/home/node/app/plugins`
- `docker/extensions` -> `/home/node/app/public/scripts/extensions/third-party`

Use local builds after code updates:

```sh
docker --context desktop-linux compose -f docker/docker-compose.yml build \
  --build-arg HTTP_PROXY=http://host.docker.internal:7890 \
  --build-arg HTTPS_PROXY=http://host.docker.internal:7890 \
  --build-arg NO_PROXY=localhost,127.0.0.1,host.docker.internal \
  sillytavern

docker --context desktop-linux compose -f docker/docker-compose.yml up -d --no-build --pull never --wait
```

Do not replace or delete `docker/data` during version updates. It contains user accounts, chats, settings, assets, and other reusable SillyTavern state.
