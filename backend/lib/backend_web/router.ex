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

    post "/users/register", UserController, :register
    post "/users/login", UserController, :login
  end

  scope "/api", BackendWeb do
    pipe_through [:api, :authenticated]

    get "/servers", ServerController, :index
    post "/servers", ServerController, :create
    put "/servers/:id", ServerController, :update
    delete "/servers/:id", ServerController, :delete
    get "/servers/:id/channels", ServerController, :channels
    post "/servers/:server_id/channels", ServerController, :create_channel
    get "/servers/:id/members", ServerController, :members
    delete "/servers/:server_id/members/:user_id", ServerController, :delete_member

    delete "/channels/:id", ChannelController, :delete

    post "/servers/:server_id/invites", InviteController, :create
    post "/invites/:code/accept", InviteController, :accept

    post "/upload", UploadController, :create
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
