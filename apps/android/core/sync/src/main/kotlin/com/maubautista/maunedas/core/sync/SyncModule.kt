package com.maubautista.maunedas.core.sync

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@Module
@InstallIn(SingletonComponent::class)
abstract class SyncModule {
    @Binds
    abstract fun requester(scheduler: SyncScheduler): SyncRequester

    @Binds
    abstract fun uploads(scheduler: SyncScheduler): UploadRequester
}
