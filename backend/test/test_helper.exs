# assert_receive/assert_reply/assert_push wait up to this long (ExUnit's
# default is 100 ms). A passing assertion returns as soon as the message
# arrives, so this only matters when CI is slow: a channel handler doing a
# few DB round trips occasionally took longer than 100 ms there and failed
# a correct test. Only a genuinely failing assertion now waits the full 1 s.
ExUnit.start(assert_receive_timeout: 1_000)
Ecto.Adapters.SQL.Sandbox.mode(Backend.Repo, :manual)
