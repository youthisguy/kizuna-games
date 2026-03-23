"use client";

import { createContext, useContext, useState, ReactNode, useMemo } from "react";
import {
  StellarWalletsKit,
  WalletNetwork,
  FreighterModule,
  AlbedoModule,
  xBullModule,
  LobstrModule,
} from "@creit.tech/stellar-wallets-kit";
import {
  WalletConnectModule,
  WalletConnectAllowedMethods,
} from "@creit.tech/stellar-wallets-kit/modules/walletconnect.module";

interface WalletContextType {
  address: string | null;
  setAddress: (addr: string | null) => void;
  walletsKit: StellarWalletsKit;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);

  const walletsKit = useMemo(
    () =>
      new StellarWalletsKit({
        network: WalletNetwork.TESTNET,
        modules: [
          new FreighterModule(),
          new AlbedoModule(),
          new xBullModule(),
          new LobstrModule(),
          new WalletConnectModule({
            projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
            name: "KingFall",
            description:
              "P2P onchain chess on Stellar. Stake XLM, winner takes all.",
            url: "https://kingfall-self.vercel.app/",
            icons: ["https://kingfall-self.vercel.app/icon.png"],
            method: WalletConnectAllowedMethods.SIGN,
            network: WalletNetwork.TESTNET,
          }),
        ],
      }),
    []
  );

  return (
    <WalletContext.Provider value={{ address, setAddress, walletsKit }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
