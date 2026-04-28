"use client";

import {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
} from "react";

interface WalletContextType {
  address: string | null;
  setAddress: (addr: string | null) => void;
  walletsKit: any;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [walletsKit, setWalletsKit] = useState<any>(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const {
        StellarWalletsKit,
        WalletNetwork,
        FreighterModule,
        AlbedoModule,
        xBullModule,
        LobstrModule,
      } = await import("@creit.tech/stellar-wallets-kit");

      const {
        WalletConnectModule,
        WalletConnectAllowedMethods,
      } = await import(
        "@creit.tech/stellar-wallets-kit/modules/walletconnect.module"
      );

      const kit = new StellarWalletsKit({
        network: WalletNetwork.TESTNET,
        modules: [
          new FreighterModule(),
          new AlbedoModule(),
          new xBullModule(),
          new LobstrModule(),
          new WalletConnectModule({
            projectId:
              process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
            name: "Kizuna",
            description:
              "P2P onchain chess on Stellar. Stake XLM, winner takes all.",
            url: "https://kizuna.vercel.app/",
            icons: ["https://kizuna.vercel.app/icon.png"],
            method: WalletConnectAllowedMethods.SIGN,
            network: WalletNetwork.TESTNET,
          }),
        ],
      });

      if (mounted) setWalletsKit(kit);
    }

    init();

    return () => {
      mounted = false;
    };
  }, []);

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