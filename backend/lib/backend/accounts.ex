defmodule Backend.Accounts do
  alias Backend.Repo
  alias Backend.Accounts.User

  @token_salt "user socket"
  @token_max_age 60 * 60 * 24

  @doc "Registers a new user with hashed password."
  def create_user(attrs) do
    %User{}
    |> User.registration_changeset(attrs)
    |> Repo.insert()
  end

  @doc "Fetches a user by email. Returns nil if not found."
  def get_user_by_email(email) when is_binary(email) do
    Repo.get_by(User, email: email)
  end

  @doc "Fetches a user by id. Returns nil if not found."
  def get_user(id) do
    Repo.get(User, id)
  end

  @doc """
  Authenticates a user by email and password.

  Returns `{:ok, user}` on success, or `{:error, :invalid_credentials}`.
  Uses a constant-time dummy hash check when the user does not exist to
  prevent user-enumeration via timing differences.
  """
  def authenticate_user(email, password) do
    user = get_user_by_email(email)

    cond do
      user && Pbkdf2.verify_pass(password, user.password_hash) ->
        {:ok, user}

      user ->
        {:error, :invalid_credentials}

      true ->
        # Prevent timing attacks: always run a hash operation even when user not found.
        Pbkdf2.no_user_verify()
        {:error, :invalid_credentials}
    end
  end

  @doc "Signs a token identifying the given user, valid for 24 hours."
  def generate_user_token(user) do
    Phoenix.Token.sign(BackendWeb.Endpoint, @token_salt, user.id)
  end

  @doc """
  Verifies a user token produced by `generate_user_token/1`.

  Returns `{:ok, user_id}` if the token is valid and not expired, or
  `{:error, reason}` (`:invalid` or `:expired`) otherwise.
  """
  def verify_user_token(token) do
    Phoenix.Token.verify(BackendWeb.Endpoint, @token_salt, token, max_age: @token_max_age)
  end

  @doc "Updates the online/offline status of a user."
  def update_status(user, status) when status in ["online", "offline"] do
    user
    |> Ecto.Changeset.change(status: status)
    |> Repo.update()
  end
end
