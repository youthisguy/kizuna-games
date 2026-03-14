import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CAPT3BPZD7MN6TKLDPXN6JYO7DSAP7TJRACQRZ5BJX7V7EPH2C6HHN2A",
  }
} as const

export type DataKey = {tag: "Admin", values: void} | {tag: "EscrowContract", values: void} | {tag: "NftContract", values: void} | {tag: "FeeBalance", values: readonly [string]} | {tag: "PrizePool", values: readonly [string]} | {tag: "LeaderboardEntry", values: readonly [string]} | {tag: "TopPlayers", values: void} | {tag: "SeasonActive", values: void} | {tag: "SeasonId", values: void};


export interface LifetimeStats {
  draws: u32;
  earned: i128;
  losses: u32;
  player: string;
  wins: u32;
}


export interface PrizeAllocation {
  amount: i128;
  player: string;
}

export interface Client {
  /**
   * Construct and simulate a get_stats transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_stats: ({player}: {player: string}, options?: MethodOptions) => Promise<AssembledTransaction<LifetimeStats>>

  /**
   * Construct and simulate a end_season transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  end_season: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin, escrow_contract, nft_contract}: {admin: string, escrow_contract: string, nft_contract: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a fee_balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  fee_balance: ({token}: {token: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a start_season transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  start_season: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a record_result transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  record_result: ({game_id, winner, loser, token, fee, winnings, is_draw, white, black}: {game_id: u64, winner: Option<string>, loser: Option<string>, token: string, fee: i128, winnings: i128, is_draw: boolean, white: string, black: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a withdraw_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  withdraw_fees: ({token, amount, to}: {token: string, amount: i128, to: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a transfer_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a fund_prize_pool transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  fund_prize_pool: ({funder, token, amount}: {funder: string, token: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_leaderboard transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_leaderboard: (options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a distribute_season transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  distribute_season: ({token, allocations}: {token: string, allocations: Array<PrizeAllocation>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a prize_pool_balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  prize_pool_balance: ({token}: {token: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a update_nft_contract transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  update_nft_contract: ({nft_contract}: {nft_contract: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a snapshot_leaderboard transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  snapshot_leaderboard: ({players}: {players: Array<string>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a update_escrow_contract transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  update_escrow_contract: ({escrow_contract}: {escrow_contract: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAAAAAAAJZ2V0X3N0YXRzAAAAAAAAAQAAAAAAAAAGcGxheWVyAAAAAAATAAAAAQAAB9AAAAANTGlmZXRpbWVTdGF0cwAAAA==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAACQAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAAORXNjcm93Q29udHJhY3QAAAAAAAAAAAAAAAAAC05mdENvbnRyYWN0AAAAAAEAAAAAAAAACkZlZUJhbGFuY2UAAAAAAAEAAAATAAAAAQAAAAAAAAAJUHJpemVQb29sAAAAAAAAAQAAABMAAAABAAAAAAAAABBMZWFkZXJib2FyZEVudHJ5AAAAAQAAABMAAAAAAAAAAAAAAApUb3BQbGF5ZXJzAAAAAAAAAAAAAAAAAAxTZWFzb25BY3RpdmUAAAAAAAAAAAAAAAhTZWFzb25JZA==",
        "AAAAAAAAAAAAAAAKZW5kX3NlYXNvbgAAAAAAAAAAAAA=",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAwAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAA9lc2Nyb3dfY29udHJhY3QAAAAAEwAAAAAAAAAMbmZ0X2NvbnRyYWN0AAAAEwAAAAA=",
        "AAAAAAAAAAAAAAALZmVlX2JhbGFuY2UAAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAMc3RhcnRfc2Vhc29uAAAAAAAAAAEAAAAE",
        "AAAAAAAAAAAAAAANcmVjb3JkX3Jlc3VsdAAAAAAAAAkAAAAAAAAAB2dhbWVfaWQAAAAABgAAAAAAAAAGd2lubmVyAAAAAAPoAAAAEwAAAAAAAAAFbG9zZXIAAAAAAAPoAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAANmZWUAAAAACwAAAAAAAAAId2lubmluZ3MAAAALAAAAAAAAAAdpc19kcmF3AAAAAAEAAAAAAAAABXdoaXRlAAAAAAAAEwAAAAAAAAAFYmxhY2sAAAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAANd2l0aGRyYXdfZmVlcwAAAAAAAAMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAJ0bwAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAOdHJhbnNmZXJfYWRtaW4AAAAAAAEAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAPZnVuZF9wcml6ZV9wb29sAAAAAAMAAAAAAAAABmZ1bmRlcgAAAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAA",
        "AAAAAAAAAAAAAAAPZ2V0X2xlYWRlcmJvYXJkAAAAAAAAAAABAAAD6gAAABM=",
        "AAAAAQAAAAAAAAAAAAAADUxpZmV0aW1lU3RhdHMAAAAAAAAFAAAAAAAAAAVkcmF3cwAAAAAAAAQAAAAAAAAABmVhcm5lZAAAAAAACwAAAAAAAAAGbG9zc2VzAAAAAAAEAAAAAAAAAAZwbGF5ZXIAAAAAABMAAAAAAAAABHdpbnMAAAAE",
        "AAAAAAAAAAAAAAARZGlzdHJpYnV0ZV9zZWFzb24AAAAAAAACAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAAC2FsbG9jYXRpb25zAAAAA+oAAAfQAAAAD1ByaXplQWxsb2NhdGlvbgAAAAAA",
        "AAAAAQAAAAAAAAAAAAAAD1ByaXplQWxsb2NhdGlvbgAAAAACAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAABnBsYXllcgAAAAAAEw==",
        "AAAAAAAAAAAAAAAScHJpemVfcG9vbF9iYWxhbmNlAAAAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAACw==",
        "AAAAAAAAAAAAAAATdXBkYXRlX25mdF9jb250cmFjdAAAAAABAAAAAAAAAAxuZnRfY29udHJhY3QAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAUc25hcHNob3RfbGVhZGVyYm9hcmQAAAABAAAAAAAAAAdwbGF5ZXJzAAAAA+oAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAWdXBkYXRlX2VzY3Jvd19jb250cmFjdAAAAAAAAQAAAAAAAAAPZXNjcm93X2NvbnRyYWN0AAAAABMAAAAA" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_stats: this.txFromJSON<LifetimeStats>,
        end_season: this.txFromJSON<null>,
        initialize: this.txFromJSON<null>,
        fee_balance: this.txFromJSON<i128>,
        start_season: this.txFromJSON<u32>,
        record_result: this.txFromJSON<null>,
        withdraw_fees: this.txFromJSON<null>,
        transfer_admin: this.txFromJSON<null>,
        fund_prize_pool: this.txFromJSON<null>,
        get_leaderboard: this.txFromJSON<Array<string>>,
        distribute_season: this.txFromJSON<null>,
        prize_pool_balance: this.txFromJSON<i128>,
        update_nft_contract: this.txFromJSON<null>,
        snapshot_leaderboard: this.txFromJSON<null>,
        update_escrow_contract: this.txFromJSON<null>
  }
}