import { FetchOptions, FetchResultV2, SimpleAdapter } from "../../adapters/types";
import { CHAIN } from "../../helpers/chains";

const GRID_MINING = "0xb7e809dd2fabd52cd6960f54ca5f19afff7f70af";

const ADMIN_FEE_BPS = 300n;
const VAULT_FEE_BPS = 1000n;
const BPS = 10000n;

const DEPLOYED_ABI =
  "event Deployed(uint64 indexed roundId, address indexed user, uint256 amountPerBlock, uint256 blockMask, uint256 totalAmount)";
const DEPLOYED_FOR_ABI =
  "event DeployedFor(uint64 indexed roundId, address indexed user, address indexed executor, uint256 amountPerBlock, uint256 blockMask, uint256 totalAmount)";
const ROUND_SETTLED_ABI =
  "event RoundSettled(uint64 indexed roundId, uint8 winningBlock, address topMiner, uint256 totalWinnings, uint256 topMinerReward, uint256 beanpotAmount, bool isSplit, uint256 topMinerSeed, uint256 winnersDeployed)";

const fetch = async ({ getLogs, createBalances }: FetchOptions): Promise<FetchResultV2> => {
  const dailyFees = createBalances();
  const dailyProtocolRevenue = createBalances();

  const [deployLogs, deployForLogs, settledLogs] = await Promise.all([
    getLogs({ target: GRID_MINING, eventAbi: DEPLOYED_ABI }),
    getLogs({ target: GRID_MINING, eventAbi: DEPLOYED_FOR_ABI }),
    getLogs({ target: GRID_MINING, eventAbi: ROUND_SETTLED_ABI }),
  ]);

  const totalDeployedByRound = new Map<string, bigint>();

  for (const log of [...deployLogs, ...deployForLogs]) {
    const roundId = String(log.roundId);
    const totalAmount = BigInt(log.totalAmount);
    totalDeployedByRound.set(roundId, (totalDeployedByRound.get(roundId) ?? 0n) + totalAmount);
  }

  for (const log of settledLogs) {
    const roundId = String(log.roundId);
    const totalDeployed = totalDeployedByRound.get(roundId) ?? 0n;
    if (totalDeployed === 0n) continue;

    const winnersDeployed = BigInt(log.winnersDeployed);
    const adminFee = (totalDeployed * ADMIN_FEE_BPS) / BPS;

    let vaultAmount = 0n;

    if (winnersDeployed === 0n) {
      vaultAmount = totalDeployed - adminFee;
    } else {
      const losersPool = totalDeployed - winnersDeployed;
      const losersAdminShare = (losersPool * ADMIN_FEE_BPS) / BPS;
      const losersAfterAdmin = losersPool - losersAdminShare;
      vaultAmount = (losersAfterAdmin * VAULT_FEE_BPS) / BPS;
    }

    const roundFees = adminFee + vaultAmount;
    if (roundFees > 0n) {
      dailyFees.addGasToken(roundFees, "Round settlement fees");
      dailyProtocolRevenue.addGasToken(roundFees, "Round settlement fees");
    }
  }

  return {
    dailyFees,
    dailyRevenue: dailyProtocolRevenue,
    dailyProtocolRevenue,
  };
};

const adapter: SimpleAdapter = {
  version: 2,
  chains: [CHAIN.MEGAETH],
  start: "2026-03-08",
  fetch,
  methodology: {
    Fees: "MegaMine charges a 3% admin fee on round deposits and routes a treasury vault cut from losing-side ETH during round settlement.",
    Revenue: "All counted revenue in this adapter is protocol-owned ETH captured by the fee collector and treasury.",
    ProtocolRevenue: "Protocol revenue equals the admin fee plus treasury vault intake from each settled round.",
  },
  pullHourly: true,
};

export default adapter;
