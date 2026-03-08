"use client";

import { createContext, useContext, useState, ReactNode, useMemo } from "react";
import {
  StellarWalletsKit,
  WalletNetwork,
  FreighterModule,
  AlbedoModule,
  xBullModule,
} from "@creit.tech/stellar-wallets-kit";

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

        modules: [new FreighterModule(), new AlbedoModule(), new xBullModule()],
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
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
