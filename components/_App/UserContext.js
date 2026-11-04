import { createContext, useContext } from "react";

// The signed-in user as verified on the server in _app.getInitialProps
// (token -> database). Lets shared chrome such as the footer be role-aware
// without every page passing the user down.
const UserContext = createContext(null);
export const UserProvider = UserContext.Provider;
export const useCurrentUser = () => useContext(UserContext);
