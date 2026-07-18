defmodule BackendWeb.Router do
  use BackendWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :authenticated do
    plug BackendWeb.AuthPlug
  end

  scope "/api", BackendWeb do
    pipe_through :api

    # Unauthenticated by design — an orchestrator's health check has no
    # user token to send. Also exempted from BackendWeb.RequireCloudflarePlug
    # (see its @exempt_paths) since Render/Railway's own health checker hits
    # this directly, bypassing Cloudflare entirely, and from any
    # BackendWeb.RateLimiterPlug (simply never attached here) — a health
    # check tripping a rate limit and starting to read as "unhealthy" would
    # be exactly backwards.
    get "/healthz", HealthController, :show

    post "/users/register", UserController, :register
    post "/users/login", UserController, :login
  end

  scope "/api", BackendWeb do
    pipe_through [:api, :authenticated]

    post "/users/logout_all", UserController, :logout_all

    get "/servers", ServerController, :index
    post "/servers", ServerController, :create
    put "/servers/:id", ServerController, :update
    delete "/servers/:id", ServerController, :delete
    delete "/servers/:server_id/leave", ServerController, :leave
    get "/servers/:id/channels", ServerController, :channels
    post "/servers/:server_id/channels", ServerController, :create_channel
    patch "/servers/:server_id/channels/positions", ServerController, :update_channel_positions
    get "/servers/:id/members", ServerController, :members
    delete "/servers/:server_id/members/:user_id", ServerController, :delete_member

    get "/servers/:server_id/channels/:channel_id/messages", ChannelController, :messages
    get "/channels/:channel_id/search", ChannelController, :search
    delete "/channels/:id", ChannelController, :delete

    get "/servers/:server_id/invites", InviteController, :index
    post "/servers/:server_id/invites", InviteController, :create
    delete "/servers/:server_id/invites/:id", InviteController, :delete
    post "/invites/:code/accept", InviteController, :accept

    post "/upload", UploadController, :create

    get "/friends", FriendController, :index
    post "/friends/request", FriendController, :request
    post "/friends/accept", FriendController, :accept
    delete "/friends/:id", FriendController, :delete

    get "/dms", DmController, :index
    post "/dms", DmController, :create
    get "/dms/:room_id/messages", DmController, :messages
    get "/dm_rooms/:dm_room_id/search", DmController, :search

    get "/utils/preview", PreviewController, :show
  end

  # Enable LiveDashboard and Swoosh mailbox preview in development
  if Application.compile_env(:backend, :dev_routes) do
    # If you want to use the LiveDashboard in production, you should put
    # it behind authentication and allow only admins to access it.
    # If your application does not have an admins-only section yet,
    # you can use Plug.BasicAuth to set up some basic authentication
    # as long as you are also using SSL (which you should anyway).
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through [:fetch_session, :protect_from_forgery]

      live_dashboard "/dashboard", metrics: BackendWeb.Telemetry
      forward "/mailbox", Plug.Swoosh.MailboxPreview
    end
  end
end
