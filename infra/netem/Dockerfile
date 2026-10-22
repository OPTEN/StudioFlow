# Network impairment sidecar for tests (compose profile "chaos"). It runs in the network namespace of the target
# service (network_mode: service:livekit) and shapes traffic in both directions with tc netem (ingress via ifb).
FROM alpine:3.22.7
RUN apk add --no-cache iproute2-tc iproute2-minimal
COPY --chmod=0755 netem.sh /usr/local/bin/netem
ENTRYPOINT ["/usr/local/bin/netem"]
