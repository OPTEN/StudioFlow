#!/bin/sh
# Network impairment in the current network namespace, egress and ingress (ingress is mirrored to ifb0).
#
#   netem apply <delay_ms> <jitter_ms> <loss_pct> [rate]   e.g. apply 100 10 0, apply 0 0 5, apply 0 0 0 400kbit
#   netem clear                                            remove every impairment
#   netem show                                             print the queueing disciplines
#
# The qdiscs live in the target's namespace and stay after this container exits; they disappear when the target
# container is recreated. Environment: NETEM_DEV (default eth0).
set -eu

DEV="${NETEM_DEV:-eth0}"
IFB=ifb0

usage() {
	echo "usage: netem apply <delay_ms> <jitter_ms> <loss_pct> [rate] | clear | show" >&2
	exit 2
}

is_number() {
	case "$1" in
		'' | . | *[!0-9.]* | *.*.*) return 1 ;;
		*) return 0 ;;
	esac
}

clear_all() {
	tc qdisc del dev "$DEV" root 2>/dev/null || true
	tc qdisc del dev "$DEV" ingress 2>/dev/null || true
	tc qdisc del dev "$IFB" root 2>/dev/null || true
	ip link del "$IFB" 2>/dev/null || true
}

apply() {
	[ $# -ge 3 ] && [ $# -le 4 ] || usage
	delay="$1" jitter="$2" loss="$3" rate="${4:-}"
	for value in "$delay" "$jitter" "$loss"; do
		is_number "$value" || { echo "netem: '$value' is not a number" >&2; exit 2; }
	done
	if [ -n "$rate" ]; then
		case "$rate" in
			*[!0-9a-zA-Z]* | [!0-9]*) echo "netem: invalid rate '$rate' (e.g. 400kbit, 2mbit)" >&2; exit 2 ;;
		esac
	fi

	clear_all
	set -- delay "${delay}ms" "${jitter}ms" loss "${loss}%"
	[ -n "$rate" ] && set -- "$@" rate "$rate"

	tc qdisc add dev "$DEV" root netem "$@"
	ip link add "$IFB" type ifb
	ip link set "$IFB" up
	tc qdisc add dev "$DEV" handle ffff: ingress
	tc filter add dev "$DEV" parent ffff: protocol all u32 match u32 0 0 action mirred egress redirect dev "$IFB"
	tc qdisc add dev "$IFB" root netem "$@"
	echo "netem on $DEV (both directions): $*"
}

case "${1:-}" in
	apply) shift; apply "$@" ;;
	clear) clear_all; echo "netem cleared on $DEV" ;;
	show) tc qdisc show ;;
	*) usage ;;
esac
