package com.maubautista.maunedas

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.maubautista.maunedas.core.auth.AuthService
import com.maubautista.maunedas.core.designsystem.MaunedasTheme
import com.maubautista.maunedas.feature.auth.LoginRoute
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.serialization.Serializable
import javax.inject.Inject

@Serializable
object LoginDestination

/** Signed in: the bottom-bar screens ([MainShell]). */
@Serializable
object MainDestination

/** Single activity (05 §4). With a saved session it opens at home without network (RF-AUTH-08). */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var auth: AuthService

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaunedasTheme {
                Surface(Modifier.fillMaxSize()) {
                    // Wait for the session to be read: no flash of the login screen for someone signed in.
                    var start by remember { mutableStateOf<Any?>(null) }
                    LaunchedEffect(Unit) { start = if (auth.isSignedIn()) MainDestination else LoginDestination }
                    start?.let { first ->
                        val nav = rememberNavController()
                        NavHost(navController = nav, startDestination = first, modifier = Modifier.safeDrawingPadding()) {
                            composable<LoginDestination> {
                                LoginRoute(onSignedIn = {
                                    nav.navigate(MainDestination) { popUpTo<LoginDestination> { inclusive = true } }
                                })
                            }
                            composable<MainDestination> {
                                MainShell(onSignedOut = {
                                    nav.navigate(LoginDestination) { popUpTo<MainDestination> { inclusive = true } }
                                })
                            }
                        }
                    }
                }
            }
        }
    }
}
