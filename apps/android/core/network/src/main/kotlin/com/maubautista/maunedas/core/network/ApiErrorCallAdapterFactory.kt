package com.maubautista.maunedas.core.network

import kotlinx.serialization.json.Json
import okhttp3.Request
import okio.Timeout
import retrofit2.Call
import retrofit2.CallAdapter
import retrofit2.Callback
import retrofit2.Response
import retrofit2.Retrofit
import java.lang.reflect.ParameterizedType
import java.lang.reflect.Type

/**
 * Turns every non-2xx answer into an [ApiException] for `suspend` Retrofit functions (they use `Call<T>`
 * underneath). Done here and not in an OkHttp interceptor: an interceptor may only throw IOException, and
 * an ApiException must not look like a network failure to the callers that retry on IOException (04 §6.3).
 */
class ApiErrorCallAdapterFactory(private val json: Json) : CallAdapter.Factory() {
    override fun get(
        returnType: Type,
        annotations: Array<out Annotation>,
        retrofit: Retrofit,
    ): CallAdapter<*, *>? {
        if (getRawType(returnType) != Call::class.java || returnType !is ParameterizedType) return null
        val responseType = getParameterUpperBound(0, returnType)
        return object : CallAdapter<Any, Call<Any>> {
            override fun responseType(): Type = responseType

            override fun adapt(call: Call<Any>): Call<Any> = ApiErrorCall(call, json)
        }
    }
}

private class ApiErrorCall<T : Any>(private val delegate: Call<T>, private val json: Json) : Call<T> {
    override fun enqueue(callback: Callback<T>) =
        delegate.enqueue(
            object : Callback<T> {
                override fun onResponse(
                    call: Call<T>,
                    response: Response<T>,
                ) {
                    if (response.isSuccessful) {
                        callback.onResponse(this@ApiErrorCall, response)
                    } else {
                        callback.onFailure(this@ApiErrorCall, ApiErrors.from(response, json))
                    }
                }

                override fun onFailure(
                    call: Call<T>,
                    t: Throwable,
                ) = callback.onFailure(this@ApiErrorCall, t)
            },
        )

    override fun execute(): Response<T> {
        val response = delegate.execute()
        if (!response.isSuccessful) throw ApiErrors.from(response, json)
        return response
    }

    override fun clone(): Call<T> = ApiErrorCall(delegate.clone(), json)

    override fun isExecuted(): Boolean = delegate.isExecuted

    override fun cancel() = delegate.cancel()

    override fun isCanceled(): Boolean = delegate.isCanceled

    override fun request(): Request = delegate.request()

    override fun timeout(): Timeout = delegate.timeout()
}
