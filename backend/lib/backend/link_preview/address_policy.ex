defmodule Backend.LinkPreview.AddressPolicy do
  @moduledoc """
  Decides which IP addresses `Backend.LinkPreview` may connect to: only
  publicly routable unicast ones. Everything an attacker could use to reach
  this server's own network through a user-supplied preview URL is refused —
  loopback, RFC 1918, link-local (including the `169.254.169.254` cloud
  metadata endpoint), CGNAT `100.64.0.0/10` (also used for PaaS-internal
  networks), IPv6 unique-local/link-local, multicast and reserved ranges.

  IPv6 is an allowlist rather than a blocklist: only global unicast
  `2000::/3` passes, minus its special-purpose blocks. IPv6 forms that embed
  an IPv4 address (IPv4-mapped `::ffff:a.b.c.d`, the deprecated
  IPv4-compatible `::a.b.c.d`, and the NAT64 prefix `64:ff9b::/96`) are
  judged by the IPv4 address inside them, since that's where the packet
  actually ends up.
  """

  import Bitwise

  @doc "True only for a publicly routable unicast IPv4 or IPv6 address."
  @spec public?(:inet.ip_address()) :: boolean()
  def public?({_, _, _, _} = ip), do: not reserved_v4?(ip)
  def public?({_, _, _, _, _, _, _, _} = ip), do: public_v6?(ip)
  def public?(_other), do: false

  # "This network" (0.0.0.0 reaches localhost on Linux).
  defp reserved_v4?({0, _, _, _}), do: true
  # RFC 1918 private.
  defp reserved_v4?({10, _, _, _}), do: true
  # Carrier-grade NAT; also what several PaaS providers use internally.
  defp reserved_v4?({100, b, _, _}) when b in 64..127, do: true
  defp reserved_v4?({127, _, _, _}), do: true
  # Link-local, including the cloud metadata service at 169.254.169.254.
  defp reserved_v4?({169, 254, _, _}), do: true
  # RFC 1918 private.
  defp reserved_v4?({172, b, _, _}) when b in 16..31, do: true
  # IETF protocol assignments.
  defp reserved_v4?({192, 0, 0, _}), do: true
  # TEST-NET-1 (documentation).
  defp reserved_v4?({192, 0, 2, _}), do: true
  # Deprecated 6to4 relay anycast.
  defp reserved_v4?({192, 88, 99, _}), do: true
  # RFC 1918 private.
  defp reserved_v4?({192, 168, _, _}), do: true
  # Benchmarking.
  defp reserved_v4?({198, b, _, _}) when b in 18..19, do: true
  # TEST-NET-2 (documentation).
  defp reserved_v4?({198, 51, 100, _}), do: true
  # TEST-NET-3 (documentation).
  defp reserved_v4?({203, 0, 113, _}), do: true
  # Multicast, reserved and limited broadcast.
  defp reserved_v4?({a, _, _, _}) when a >= 224, do: true
  defp reserved_v4?(_ip), do: false

  # IPv4-mapped (::ffff:a.b.c.d).
  defp public_v6?({0, 0, 0, 0, 0, 0xFFFF, hi, lo}), do: public?(embedded_v4(hi, lo))
  # Deprecated IPv4-compatible (::a.b.c.d) — also covers :: and ::1, whose
  # embedded "addresses" fall in 0.0.0.0/8.
  defp public_v6?({0, 0, 0, 0, 0, 0, hi, lo}), do: public?(embedded_v4(hi, lo))
  # NAT64 well-known prefix (64:ff9b::/96).
  defp public_v6?({0x64, 0xFF9B, 0, 0, 0, 0, hi, lo}), do: public?(embedded_v4(hi, lo))
  # 2001::/23 IETF special-purpose block, including Teredo (2001::/32).
  defp public_v6?({0x2001, b, _, _, _, _, _, _}) when b < 0x200, do: false
  # Documentation.
  defp public_v6?({0x2001, 0xDB8, _, _, _, _, _, _}), do: false
  # 6to4.
  defp public_v6?({0x2002, _, _, _, _, _, _, _}), do: false
  # Everything else must be global unicast (2000::/3).
  defp public_v6?({a, _, _, _, _, _, _, _}), do: a >= 0x2000 and a <= 0x3FFF

  defp embedded_v4(hi, lo), do: {hi >>> 8, hi &&& 0xFF, lo >>> 8, lo &&& 0xFF}
end
