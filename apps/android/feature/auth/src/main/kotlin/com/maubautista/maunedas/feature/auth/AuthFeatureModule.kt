package com.maubautista.maunedas.feature.auth

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@Module
@InstallIn(SingletonComponent::class)
abstract class AuthFeatureModule {
    @Binds
    abstract fun syncStarter(starter: SchedulerSyncStarter): SyncStarter
}
