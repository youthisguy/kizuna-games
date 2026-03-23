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
    contractId: "CC4NHEPTQCYD2QH3A3SBDES654KNMANJIPFVV6X63MXUZY6WZW2OPO6N",
  }
} as const

export type DataKey = {tag: "Game", values: readonly [u64]} | {tag: "NextId", values: void} | {tag: "PayoutContract", values: void};

export type Outcome = {tag: "WhiteWins", values: void} | {tag: "BlackWins", values: void} | {tag: "Draw", values: void};


export interface GameData {
  black: string;
  created_at: u64;
  draw_offered_by: Option<string>;
  join_deadline: u64;
  move_hash: string;
  stake: i128;
  status: GameStatus;
  token: string;
  white: string;
}

export type GameStatus = {tag: "Waiting", values: void} | {tag: "Active", values: void} | {tag: "Finished", values: void} | {tag: "Drawn", values: void} | {tag: "Cancelled", values: void} | {tag: "Timeout", values: void};

export interface Client {
  /**
   * Construct and simulate a get_pot transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_pot: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_game: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<GameData>>

  /**
   * Construct and simulate a join_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  join_game: ({id, black}: {id: u64, black: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a offer_draw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  offer_draw: ({id, caller}: {id: u64, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a accept_draw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  accept_draw: ({id, caller}: {id: u64, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a cancel_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_game: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a create_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  create_game: ({white, token, stake, join_deadline}: {white: string, token: string, stake: i128, join_deadline: u64}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a finish_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  finish_game: ({id, caller, outcome, move_hash}: {id: u64, caller: string, outcome: Outcome, move_hash: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a claim_timeout transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claim_timeout: ({id, caller, timeout_at}: {id: u64, caller: string, timeout_at: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_payout_contract transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_payout_contract: ({caller, payout}: {caller: string, payout: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

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
      new ContractSpec([ "AAAAAAAAAAAAAAAHZ2V0X3BvdAAAAAABAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAL",
        "AAAAAAAAAAAAAAAIZ2V0X2dhbWUAAAABAAAAAAAAAAJpZAAAAAAABgAAAAEAAAfQAAAACEdhbWVEYXRh",
        "AAAAAAAAAAAAAAAJam9pbl9nYW1lAAAAAAAAAgAAAAAAAAACaWQAAAAAAAYAAAAAAAAABWJsYWNrAAAAAAAAEwAAAAA=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAwAAAAEAAAAAAAAABEdhbWUAAAABAAAABgAAAAAAAAAAAAAABk5leHRJZAAAAAAAAAAAAAAAAAAOUGF5b3V0Q29udHJhY3QAAA==",
        "AAAAAgAAAAAAAAAAAAAAB091dGNvbWUAAAAAAwAAAAAAAAAAAAAACVdoaXRlV2lucwAAAAAAAAAAAAAAAAAACUJsYWNrV2lucwAAAAAAAAAAAAAAAAAABERyYXc=",
        "AAAAAAAAAAAAAAAKb2ZmZXJfZHJhdwAAAAAAAgAAAAAAAAACaWQAAAAAAAYAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAA=",
        "AAAAAQAAAAAAAAAAAAAACEdhbWVEYXRhAAAACQAAAAAAAAAFYmxhY2sAAAAAAAATAAAAAAAAAApjcmVhdGVkX2F0AAAAAAAGAAAAAAAAAA9kcmF3X29mZmVyZWRfYnkAAAAD6AAAABMAAAAAAAAADWpvaW5fZGVhZGxpbmUAAAAAAAAGAAAAAAAAAAltb3ZlX2hhc2gAAAAAAAAQAAAAAAAAAAVzdGFrZQAAAAAAAAsAAAAAAAAABnN0YXR1cwAAAAAH0AAAAApHYW1lU3RhdHVzAAAAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAFd2hpdGUAAAAAAAAT",
        "AAAAAAAAAAAAAAALYWNjZXB0X2RyYXcAAAAAAgAAAAAAAAACaWQAAAAAAAYAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAALY2FuY2VsX2dhbWUAAAAAAQAAAAAAAAACaWQAAAAAAAYAAAAA",
        "AAAAAAAAAAAAAAALY3JlYXRlX2dhbWUAAAAABAAAAAAAAAAFd2hpdGUAAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAABXN0YWtlAAAAAAAACwAAAAAAAAANam9pbl9kZWFkbGluZQAAAAAAAAYAAAABAAAABg==",
        "AAAAAAAAAAAAAAALZmluaXNoX2dhbWUAAAAABAAAAAAAAAACaWQAAAAAAAYAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAHb3V0Y29tZQAAAAfQAAAAB091dGNvbWUAAAAAAAAAAAltb3ZlX2hhc2gAAAAAAAAQAAAAAA==",
        "AAAAAgAAAAAAAAAAAAAACkdhbWVTdGF0dXMAAAAAAAYAAAAAAAAAAAAAAAdXYWl0aW5nAAAAAAAAAAAAAAAABkFjdGl2ZQAAAAAAAAAAAAAAAAAIRmluaXNoZWQAAAAAAAAAAAAAAAVEcmF3bgAAAAAAAAAAAAAAAAAACUNhbmNlbGxlZAAAAAAAAAAAAAAAAAAAB1RpbWVvdXQA",
        "AAAAAAAAAAAAAAANY2xhaW1fdGltZW91dAAAAAAAAAMAAAAAAAAAAmlkAAAAAAAGAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAACnRpbWVvdXRfYXQAAAAAAAYAAAAA",
        "AAAAAAAAAAAAAAATc2V0X3BheW91dF9jb250cmFjdAAAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAABnBheW91dAAAAAAAEwAAAAA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_pot: this.txFromJSON<i128>,
        get_game: this.txFromJSON<GameData>,
        join_game: this.txFromJSON<null>,
        offer_draw: this.txFromJSON<null>,
        accept_draw: this.txFromJSON<null>,
        cancel_game: this.txFromJSON<null>,
        create_game: this.txFromJSON<u64>,
        finish_game: this.txFromJSON<null>,
        claim_timeout: this.txFromJSON<null>,
        set_payout_contract: this.txFromJSON<null>
  }
}