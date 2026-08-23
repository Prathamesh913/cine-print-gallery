export interface AuthInitializationApi<TAuth, TUser> {
  onAuthStateChanged: (auth: TAuth, callback: (user: TUser | null) => void) => () => void;
  getRedirectResult: (auth: TAuth) => Promise<{ user: TUser | null } | null>;
}

/**
 * Attach the auth listener before checking redirect state. Firebase's redirect
 * lookup can be delayed independently of the persisted auth-state callback.
 */
export function initializeAuthSession<TAuth, TUser>(
  auth: TAuth,
  api: AuthInitializationApi<TAuth, TUser>,
  onUser: (user: TUser | null) => void,
  onReady: () => void,
) {
  const unsubscribe = api.onAuthStateChanged(auth, (user) => {
    onUser(user);
    onReady();
  });

  void api
    .getRedirectResult(auth)
    .then((result) => {
      if (result?.user) onUser(result.user);
    })
    .catch(() => {
      // A redirect-result failure must not block the auth-state listener.
    });

  return unsubscribe;
}
