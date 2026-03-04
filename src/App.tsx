import { useMemo } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RainbowKitProvider,
  darkTheme,
  lightTheme,
} from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";

import { EpixNetProvider, useEpixNet } from "./contexts/EpixNetContext";
import { createEpixChain } from "./config/chain";
import { createWagmiConfig } from "./config/wagmi";
import Layout from "./components/Layout";
import RegisterPage from "./pages/RegisterPage";
import SearchPage from "./pages/SearchPage";
import MyNamesPage from "./pages/MyNamesPage";
import NameDetailPage from "./pages/NameDetailPage";
import StatsPage from "./pages/StatsPage";
import PricesPage from "./pages/PricesPage";
import AddPeerPage from "./pages/AddPeerPage";

const queryClient = new QueryClient();

// Check real query string for addPeer param (forwarded by EpixNet wrapper).
// This bypasses HashRouter since the wrapper doesn't reliably forward hash
// fragments to the inner iframe.
const realParams = new URLSearchParams(window.location.search);
const isAddPeerMode = realParams.has("addPeer");

function AppInner() {
  const { theme, rpcUrl, ready } = useEpixNet();

  const chain = useMemo(
    () => createEpixChain(rpcUrl ?? undefined),
    [rpcUrl],
  );
  const wagmiConfig = useMemo(() => createWagmiConfig(chain), [chain]);

  const rkTheme = useMemo(
    () =>
      theme === "light"
        ? lightTheme({ accentColor: "#6366f1", borderRadius: "small" })
        : darkTheme({ accentColor: "#6366f1", borderRadius: "small" }),
    [theme],
  );

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div
          className="animate-spin rounded-full h-6 w-6 border-2 border-transparent"
          style={{ borderTopColor: "var(--color-accent)" }}
        />
      </div>
    );
  }

  // When addPeer query param is present, render AddPeerPage directly
  // without the sidebar/layout chrome.
  if (isAddPeerMode) {
    return (
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider theme={rkTheme}>
            <AddPeerPage />
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    );
  }

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={rkTheme}>
          <HashRouter>
            <Layout>
              <Routes>
                <Route path="/" element={<RegisterPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/my-names" element={<MyNamesPage />} />
                <Route
                  path="/name/:tld/:name"
                  element={<NameDetailPage />}
                />
                <Route path="/prices" element={<PricesPage />} />
                <Route path="/stats" element={<StatsPage />} />
                <Route path="/link-identity" element={<AddPeerPage />} />
              </Routes>
            </Layout>
          </HashRouter>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default function App() {
  return (
    <EpixNetProvider>
      <AppInner />
    </EpixNetProvider>
  );
}
