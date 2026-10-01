#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="/home/fady_id/ischool-competition"
cd "$DEPLOY_DIR"

LOCK_FILE="$DEPLOY_DIR/deploy.lock"
exec 200>"$LOCK_FILE"
flock -n 200 || { echo "Error: Another deployment is currently running." >&2; exit 1; }

RAW_CMD="${SSH_ORIGINAL_COMMAND:-$*}"
CMD="$(echo "$RAW_CMD" | tr -d '\r' | xargs)"

ACTION=""
TARGET_TAG=""

if [[ "$CMD" =~ ^deploy[[:space:]]+([0-9a-fA-F]{40})$ ]]; then
    ACTION="deploy"
    TARGET_TAG="${BASH_REMATCH[1]}"
elif [[ "$CMD" == "rollback" ]]; then
    ACTION="rollback"
    if [[ ! -f "$DEPLOY_DIR/.previous_tag" ]] || [[ ! -s "$DEPLOY_DIR/.previous_tag" ]]; then
        echo "Error: No .previous_tag file found for rollback." >&2
        exit 1
    fi
    TARGET_TAG="$(tr -d '\r\n' < "$DEPLOY_DIR/.previous_tag")"
else
    echo "Error: Invalid command. Only 'deploy <40-hex-sha>' or 'rollback' are allowed." >&2
    exit 1
fi

export DOCKER_CONFIG="$DEPLOY_DIR/.docker"
mkdir -p "$DOCKER_CONFIG"
chmod 700 "$DOCKER_CONFIG"

cleanup_auth() {
    docker logout ghcr.io >/dev/null 2>&1 || true
    rm -f "$DOCKER_CONFIG/config.json"
}
trap cleanup_auth EXIT

if [ ! -t 0 ]; then
    TOKEN="$(cat)"
    if [ -n "$TOKEN" ]; then
        echo "$TOKEN" | docker login ghcr.io -u youmna3 --password-stdin
    fi
fi

if [ "$ACTION" = "deploy" ]; then
    echo "Pulling ghcr.io/youmna3/competition-platform:${TARGET_TAG}..."
    if ! docker pull "ghcr.io/youmna3/competition-platform:${TARGET_TAG}"; then
        if docker image inspect "ghcr.io/youmna3/competition-platform:${TARGET_TAG}" >/dev/null 2>&1; then
            echo "Pull failed or registry unauthenticated, using existing local image."
        else
            echo "Error: Image ghcr.io/youmna3/competition-platform:${TARGET_TAG} could not be pulled and does not exist locally." >&2
            exit 1
        fi
    fi
fi

cleanup_auth

if [ -f "$DEPLOY_DIR/.current_tag" ]; then
    cat "$DEPLOY_DIR/.current_tag" > "$DEPLOY_DIR/.previous_tag"
fi

echo "Starting container with IMAGE_TAG=${TARGET_TAG}..."
IMAGE_TAG="$TARGET_TAG" docker compose -f "$DEPLOY_DIR/docker-compose.yml" -p ischool_competition up -d

echo "Waiting for ischool_competition_web to become healthy..."
HEALTHY=false
for i in $(seq 1 60); do
    STATUS=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' ischool_competition_web 2>/dev/null || echo "starting")
    if [ "$STATUS" = "healthy" ]; then
        HEALTHY=true
        break
    fi
    sleep 1
done

if [ "$HEALTHY" = true ]; then
    echo "Deployment successful: container is healthy."
    echo "$TARGET_TAG" > "$DEPLOY_DIR/.current_tag"
else
    echo "Deployment failed: container did not become healthy within 60s." >&2
    if [ -f "$DEPLOY_DIR/.previous_tag" ] && [ -s "$DEPLOY_DIR/.previous_tag" ]; then
        ROLLBACK_TAG="$(tr -d '\r\n' < "$DEPLOY_DIR/.previous_tag")"
        echo "Auto-reverting to previous tag: $ROLLBACK_TAG" >&2
        IMAGE_TAG="$ROLLBACK_TAG" docker compose -f "$DEPLOY_DIR/docker-compose.yml" -p ischool_competition up -d
        echo "$ROLLBACK_TAG" > "$DEPLOY_DIR/.current_tag"
    fi
    exit 1
fi

CURRENT="$(cat "$DEPLOY_DIR/.current_tag" 2>/dev/null | tr -d '\r\n' || true)"
PREVIOUS="$(cat "$DEPLOY_DIR/.previous_tag" 2>/dev/null | tr -d '\r\n' || true)"

docker images --format '{{.Repository}}:{{.Tag}}' | grep '^ghcr.io/youmna3/competition-platform:' | while read -r img; do
    tag="${img#ghcr.io/youmna3/competition-platform:}"
    if [ "$tag" != "$CURRENT" ] && [ "$tag" != "$PREVIOUS" ] && [ "$tag" != "<none>" ] && [ "$tag" != "latest" ] && [ "$tag" != "production" ]; then
        echo "Removing obsolete image: $img"
        docker rmi "$img" >/dev/null 2>&1 || true
    fi
done
