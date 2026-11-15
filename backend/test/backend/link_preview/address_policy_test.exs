defmodule Backend.LinkPreview.AddressPolicyTest do
  use ExUnit.Case, async: true

  alias Backend.LinkPreview.AddressPolicy

  @public [
    "93.184.216.34",
    "1.1.1.1",
    "8.8.8.8",
    "100.63.255.255",
    "100.128.0.0",
    "172.15.255.255",
    "172.32.0.0",
    "223.255.255.255",
    "2606:4700:4700::1111",
    "2a00:1450:4001:80b::200e",
    "::ffff:93.184.216.34",
    "64:ff9b::5db8:d822"
  ]

  @not_public [
    # IPv4
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "100.64.0.1",
    "100.127.255.254",
    "127.0.0.1",
    "127.255.255.255",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.8",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.0.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    # IPv6
    "::",
    "::1",
    "::127.0.0.1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "64:ff9b::7f00:1",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b:1::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "2001::1",
    "2001:db8::1",
    "2002:7f00:1::1",
    "1000::1",
    "4000::1"
  ]

  for address <- @public do
    test "#{address} is public" do
      assert AddressPolicy.public?(parse!(unquote(address)))
    end
  end

  for address <- @not_public do
    test "#{address} is not public" do
      refute AddressPolicy.public?(parse!(unquote(address)))
    end
  end

  test "anything that isn't an IP tuple is not public" do
    refute AddressPolicy.public?("127.0.0.1")
    refute AddressPolicy.public?(nil)
  end

  defp parse!(address) do
    {:ok, ip} = :inet.parse_strict_address(String.to_charlist(address))
    ip
  end
end
