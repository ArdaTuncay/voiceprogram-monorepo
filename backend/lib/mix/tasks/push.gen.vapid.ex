defmodule Mix.Tasks.Push.Gen.Vapid do
  @shortdoc "Generates a VAPID key pair for Web Push"
  @moduledoc """
  Prints a new VAPID key pair for `Backend.Push`, ready to paste into the
  environment:

      mix push.gen.vapid

  Generate it once. Changing the key later stops every existing
  subscription from working: browsers subscribed with the old public key,
  and each user would have to turn notifications on again.
  """
  use Mix.Task

  alias Backend.Push.WebPush

  @impl true
  def run(_args) do
    {public, private} = WebPush.new_keypair()

    Mix.shell().info("""
    VAPID_PUBLIC_KEY=#{Base.url_encode64(public, padding: false)}
    VAPID_PRIVATE_KEY=#{Base.url_encode64(private, padding: false)}
    VAPID_SUBJECT=mailto:you@example.com
    """)
  end
end
