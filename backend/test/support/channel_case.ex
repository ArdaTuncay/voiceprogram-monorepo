defmodule BackendWeb.ChannelCase do
  @moduledoc """
  Test case for Phoenix channel tests — mirrors `BackendWeb.ConnCase`
  (sandboxed DB access) but imports `Phoenix.ChannelTest` instead of
  `Phoenix.ConnTest`, and pulls in `Backend.Fixtures` for building the
  users/servers/rooms these tests join channels as.
  """

  use ExUnit.CaseTemplate

  using do
    quote do
      import Phoenix.ChannelTest
      import Backend.Fixtures
      import BackendWeb.ChannelCase

      @endpoint BackendWeb.Endpoint
    end
  end

  setup tags do
    Backend.DataCase.setup_sandbox(tags)
    :ok
  end
end
