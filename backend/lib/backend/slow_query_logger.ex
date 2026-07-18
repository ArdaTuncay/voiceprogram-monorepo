defmodule Backend.SlowQueryLogger do
  @moduledoc """
  Attaches a telemetry handler to Ecto's `[:backend, :repo, :query]` event
  and warns on any query slow enough to matter in production, since the
  per-query debug logging Ecto ships with is normally disabled there (too
  noisy to run at debug level continuously).
  """

  require Logger

  @slow_query_threshold_ms 200
  @handler_id "backend-slow-query-logger"

  @doc "Attaches the handler — called once from `Backend.Application.start/2`."
  def attach do
    case :telemetry.attach(
           @handler_id,
           [:backend, :repo, :query],
           &__MODULE__.handle_event/4,
           nil
         ) do
      :ok -> :ok
      {:error, :already_exists} -> :ok
    end
  end

  @doc false
  def handle_event(_event_name, %{total_time: total_time}, metadata, _config) do
    total_time_ms = System.convert_time_unit(total_time, :native, :millisecond)

    if total_time_ms >= @slow_query_threshold_ms do
      Logger.warning("Slow query (#{total_time_ms}ms): #{metadata.query}")
    end
  end
end
