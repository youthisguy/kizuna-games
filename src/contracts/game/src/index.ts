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
    contractId: "CCDQQSY3XU35HYFEVC7ZGOQ6LOA7ZFC4LRZ2MTMMXHF5UI46SBC56AUZ",
  }
} as const

export type DataKey = {tag: "Game", values: readonly [u64]} | {tag: "NextId", values: void} | {tag: "EscrowContract", values: void};

export type GamePhase = {tag: "Active", values: void} | {tag: "Completed", values: void} | {tag: "Settled", values: void} | {tag: "Abandoned", values: void};


export interface GameState {
  black: string;
  created_at: u64;
  escrow_id: u64;
  game_id: u64;
  last_move_at: u64;
  move_timeout: u64;
  moves: Array<MoveRecord>;
  outcome: GameOutcome;
  pgn_hash: string;
  phase: GamePhase;
  white: string;
}


export interface MoveRecord {
  committed_at: u64;
  move_number: u32;
  player: string;
  san: string;
}

export type GameOutcome = {tag: "WhiteWins", values: void} | {tag: "BlackWins", values: void} | {tag: "Draw", values: void} | {tag: "Undecided", values: void};

export interface Client {
  /**
   * Construct and simulate a resign transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  resign: ({id, caller}: {id: u64, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_game: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<GameState>>

  /**
   * Construct and simulate a get_turn transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_turn: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_moves transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_moves: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Array<MoveRecord>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({escrow_contract}: {escrow_contract: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a commit_move transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  commit_move: ({id, player, san}: {id: u64, player: string, san: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a create_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  create_game: ({white, black, escrow_id, move_timeout}: {white: string, black: string, escrow_id: u64, move_timeout: u64}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a mark_settled transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  mark_settled: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a complete_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  complete_game: ({id, caller, outcome, pgn_hash}: {id: u64, caller: string, outcome: GameOutcome, pgn_hash: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_move_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_move_count: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a claim_abandonment transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claim_abandonment: ({id, caller}: {id: u64, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

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
      new ContractSpec([ "AAAAAAAAAAAAAAAGcmVzaWduAAAAAAACAAAAAAAAAAJpZAAAAAAABgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAIZ2V0X2dhbWUAAAABAAAAAAAAAAJpZAAAAAAABgAAAAEAAAfQAAAACUdhbWVTdGF0ZQAAAA==",
        "AAAAAAAAAAAAAAAIZ2V0X3R1cm4AAAABAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAT",
        "AAAAAAAAAAAAAAAJZ2V0X21vdmVzAAAAAAAAAQAAAAAAAAACaWQAAAAAAAYAAAABAAAD6gAAB9AAAAAKTW92ZVJlY29yZAAA",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAwAAAAEAAAAAAAAABEdhbWUAAAABAAAABgAAAAAAAAAAAAAABk5leHRJZAAAAAAAAAAAAAAAAAAORXNjcm93Q29udHJhY3QAAA==",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAQAAAAAAAAAPZXNjcm93X2NvbnRyYWN0AAAAABMAAAAA",
        "AAAAAAAAAAAAAAALY29tbWl0X21vdmUAAAAAAwAAAAAAAAACaWQAAAAAAAYAAAAAAAAABnBsYXllcgAAAAAAEwAAAAAAAAADc2FuAAAAABAAAAAA",
        "AAAAAAAAAAAAAAALY3JlYXRlX2dhbWUAAAAABAAAAAAAAAAFd2hpdGUAAAAAAAATAAAAAAAAAAVibGFjawAAAAAAABMAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAAAAAAADG1vdmVfdGltZW91dAAAAAYAAAABAAAABg==",
        "AAAAAgAAAAAAAAAAAAAACUdhbWVQaGFzZQAAAAAAAAQAAAAAAAAAAAAAAAZBY3RpdmUAAAAAAAAAAAAAAAAACUNvbXBsZXRlZAAAAAAAAAAAAAAAAAAAB1NldHRsZWQAAAAAAAAAAAAAAAAJQWJhbmRvbmVkAAAA",
        "AAAAAQAAAAAAAAAAAAAACUdhbWVTdGF0ZQAAAAAAAAsAAAAAAAAABWJsYWNrAAAAAAAAEwAAAAAAAAAKY3JlYXRlZF9hdAAAAAAABgAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAAAAAAHZ2FtZV9pZAAAAAAGAAAAAAAAAAxsYXN0X21vdmVfYXQAAAAGAAAAAAAAAAxtb3ZlX3RpbWVvdXQAAAAGAAAAAAAAAAVtb3ZlcwAAAAAAA+oAAAfQAAAACk1vdmVSZWNvcmQAAAAAAAAAAAAHb3V0Y29tZQAAAAfQAAAAC0dhbWVPdXRjb21lAAAAAAAAAAAIcGduX2hhc2gAAAAQAAAAAAAAAAVwaGFzZQAAAAAAB9AAAAAJR2FtZVBoYXNlAAAAAAAAAAAAAAV3aGl0ZQAAAAAAABM=",
        "AAAAAAAAAAAAAAAMbWFya19zZXR0bGVkAAAAAQAAAAAAAAACaWQAAAAAAAYAAAAA",
        "AAAAAQAAAAAAAAAAAAAACk1vdmVSZWNvcmQAAAAAAAQAAAAAAAAADGNvbW1pdHRlZF9hdAAAAAYAAAAAAAAAC21vdmVfbnVtYmVyAAAAAAQAAAAAAAAABnBsYXllcgAAAAAAEwAAAAAAAAADc2FuAAAAABA=",
        "AAAAAAAAAAAAAAANY29tcGxldGVfZ2FtZQAAAAAAAAQAAAAAAAAAAmlkAAAAAAAGAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAAB291dGNvbWUAAAAH0AAAAAtHYW1lT3V0Y29tZQAAAAAAAAAACHBnbl9oYXNoAAAAEAAAAAA=",
        "AAAAAgAAAAAAAAAAAAAAC0dhbWVPdXRjb21lAAAAAAQAAAAAAAAAAAAAAAlXaGl0ZVdpbnMAAAAAAAAAAAAAAAAAAAlCbGFja1dpbnMAAAAAAAAAAAAAAAAAAAREcmF3AAAAAAAAAAAAAAAJVW5kZWNpZGVkAAAA",
        "AAAAAAAAAAAAAAAOZ2V0X21vdmVfY291bnQAAAAAAAEAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAARY2xhaW1fYWJhbmRvbm1lbnQAAAAAAAACAAAAAAAAAAJpZAAAAAAABgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    resign: this.txFromJSON<null>,
        get_game: this.txFromJSON<GameState>,
        get_turn: this.txFromJSON<string>,
        get_moves: this.txFromJSON<Array<MoveRecord>>,
        initialize: this.txFromJSON<null>,
        commit_move: this.txFromJSON<null>,
        create_game: this.txFromJSON<u64>,
        mark_settled: this.txFromJSON<null>,
        complete_game: this.txFromJSON<null>,
        get_move_count: this.txFromJSON<u32>,
        claim_abandonment: this.txFromJSON<null>
  }
}