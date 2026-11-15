defmodule Backend.RateLimiterTest do
  use ExUnit.Case, async: true

  alias Backend.RateLimiter

  defp unique_key, do: {__MODULE__, make_ref()}

  test "allows exactly `limit` hits per window, then denies" do
    key = unique_key()

    results = for _ <- 1..6, do: RateLimiter.hit(key, :timer.minutes(1), 5)

    assert Enum.count(results, &match?({:allow, _}, &1)) == 5
    assert {:deny, retry_after_ms} = List.last(results)
    assert retry_after_ms > 0 and retry_after_ms <= :timer.minutes(1)
  end

  test "keys are independent" do
    a = unique_key()
    b = unique_key()

    for _ <- 1..3, do: RateLimiter.hit(a, :timer.minutes(1), 3)

    assert {:deny, _} = RateLimiter.hit(a, :timer.minutes(1), 3)
    assert {:allow, 1} = RateLimiter.hit(b, :timer.minutes(1), 3)
  end

  # A brute-force attempt arrives as a parallel burst. Every hit must be
  # counted, or some slip through — the reason this limiter doesn't use
  # Hammer's :sliding_window (see Backend.RateLimiter's moduledoc).
  test "counts every hit of a concurrent burst: exactly `limit` get through" do
    key = unique_key()

    allowed =
      1..200
      |> Task.async_stream(fn _ -> RateLimiter.hit(key, :timer.minutes(1), 50) end,
        max_concurrency: 50,
        timeout: :infinity
      )
      |> Enum.count(&match?({:ok, {:allow, _}}, &1))

    assert allowed == 50
  end
end
