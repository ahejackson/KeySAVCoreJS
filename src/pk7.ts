import PkBase, { registerPkmImpl } from "./pkbase_";
import * as util from "./util";

/**
 * The list of all form names in generation 6, ordered by species, then form ID.
 */
export default class Pk7 extends PkBase {
  /**
   * The TID that is shown in Generation 7 games.
   */
  public tid7: number;

  /**
   * If a stat has been hyper trained.
   */
  public htHp: boolean;
  public htAtk: boolean;
  public htDef: boolean;
  public htSpAtk: boolean;
  public htSpDef: boolean;
  public htSpe: boolean;

  /**
   * Construct a new Pk7 representation.
   *
   * @param pkx The raw Pk7 data.
   * @param box The box the Pokémon is located in.
   * @param slot The slot in the box the Pokémon is located in.
   * @param isGhost True if the Pokémon might be an artifact of bad decryption
   */
  constructor(pkx: Uint8Array, box: number, slot: number, isGhost: boolean) {
    super(pkx, box, slot, isGhost);

    this.version = 7;

    const data: DataView = util.createDataView(pkx);

    this.markings = data.getUint16(0x16, true);
    this.tid7 = data.getUint32(0x0c, true) % 1000000;

    this.htHp = ((pkx[0xde] >> 0) & 1) == 1;
    this.htAtk = ((pkx[0xde] >> 1) & 1) == 1;
    this.htDef = ((pkx[0xde] >> 2) & 1) == 1;
    this.htSpAtk = ((pkx[0xde] >> 3) & 1) == 1;
    this.htSpDef = ((pkx[0xde] >> 4) & 1) == 1;
    this.htSpe = ((pkx[0xde] >> 5) & 1) == 1;
  }
}

registerPkmImpl(7, Pk7);
