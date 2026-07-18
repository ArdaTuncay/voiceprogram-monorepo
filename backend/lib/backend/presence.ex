defmodule Backend.Presence do
  @moduledoc """
  `Phoenix.Presence` tracker shared by every channel that needs "who's
  currently here" (voice rooms, DM rooms, chat channels, and each user's
  personal topic for online/offline status).
  """

  use Phoenix.Presence,
    otp_app: :backend,
    pubsub_server: Backend.PubSub
end
