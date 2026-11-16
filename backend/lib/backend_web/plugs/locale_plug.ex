defmodule BackendWeb.LocalePlug do
  @moduledoc """
  Picks the language for this request's user-facing text — JSON error and
  info messages, and the account emails a request triggers (see
  `Backend.Accounts.UserNotifier`, which sends in the request's process) —
  from the `Accept-Language` header. The web app sends its UI language on
  every request (frontend `services/api.ts`).

  Messages are written in English (gettext msgids) with Turkish in
  `priv/gettext/tr`. Turkish is the default: Zircle's users are mostly
  Turkish, and it's what every client saw before this existed. Machine
  codes clients branch on (`"invalid_token"`, `"email_not_verified"`, the
  socket `reason`s, Ecto's changeset messages) are never translated.

  Runs in the endpoint, before the router, so plugs that answer early
  (`BackendWeb.AuthPlug`, `BackendWeb.RateLimiterPlug`) speak it too.
  """

  @behaviour Plug

  @locales ~w(tr en)
  @default "tr"

  @impl true
  def init(opts), do: opts

  @impl true
  def call(conn, _opts) do
    locale =
      case Plug.Conn.get_req_header(conn, "accept-language") do
        [header | _] -> preferred_locale(header)
        [] -> @default
      end

    Gettext.put_locale(BackendWeb.Gettext, locale)
    conn
  end

  @doc """
  The supported locale an `Accept-Language` value prefers most, by q-value
  then order; `"tr"` when it names none of them.
  """
  def preferred_locale(header) when is_binary(header) do
    header
    |> String.split(",", trim: true)
    |> Enum.with_index()
    |> Enum.flat_map(&parse_range/1)
    |> Enum.filter(fn {locale, q, _index} -> locale in @locales and q > 0 end)
    |> Enum.sort_by(fn {_locale, q, index} -> {-q, index} end)
    |> case do
      [{locale, _q, _index} | _] -> locale
      [] -> @default
    end
  end

  defp parse_range({range, index}) do
    [tag | params] = range |> String.trim() |> String.split(";")
    primary = tag |> String.split("-") |> hd() |> String.downcase()

    case quality(params) do
      {:ok, q} -> [{primary, q, index}]
      :error -> []
    end
  end

  # The range's q-value (1.0 when absent), or :error for a malformed one.
  defp quality(params) do
    case Enum.find_value(params, &q_param/1) do
      nil -> {:ok, 1.0}
      value -> parse_q(value)
    end
  end

  defp q_param(param) do
    case String.split(String.trim(param), "=", parts: 2) do
      ["q", value] -> value
      _ -> nil
    end
  end

  defp parse_q(value) do
    case Float.parse(value) do
      {q, ""} -> {:ok, q}
      _ -> :error
    end
  end
end
