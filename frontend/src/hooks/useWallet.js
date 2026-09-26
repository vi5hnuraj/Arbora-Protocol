/**
 * useWallet hook — wraps Web3Modal's React hooks for the Arbora app.
 *
 * Provides: account, chainId, isConnected, connect (opens wallet modal),
 * disconnect, and walletProvider (raw EIP-1193 provider for ethers).
 *
 * The wallet modal (MetaMask, WalletConnect, Coinbase, Ledger, etc.)
 * is rendered by Web3Modal when connect() is called.
 */
import {
  useWeb3ModalProvider,
  useWeb3ModalAccount,
  useDisconnect,
  useWeb3Modal,
} from '@web3modal/ethers/react';

export default function useWallet() {
  const { address, chainId, isConnected } = useWeb3ModalAccount();
  const { walletProvider } = useWeb3ModalProvider();
  const { disconnect } = useDisconnect();
  const { open } = useWeb3Modal();

  return {
    account: isConnected ? address : null,
    chainId,
    isConnected,
    walletProvider,  // raw EIP-1193 provider for ethers.BrowserProvider
    connect: open,   // opens the Web3Modal wallet selection UI
    disconnect,
    isConnecting: false,  // Web3Modal handles its own loading states
  };
}
