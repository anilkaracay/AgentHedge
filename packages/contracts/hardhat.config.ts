import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    xlayer: {
      url: 'https://rpc.xlayer.tech',
      chainId: 196,
      accounts: process.env.DEPLOYER_PK ? [process.env.DEPLOYER_PK] : [],
    },
    xlayer_testnet: {
      url: 'https://testrpc.xlayer.tech',
      chainId: 195,
      accounts: process.env.DEPLOYER_PK ? [process.env.DEPLOYER_PK] : [],
    },
  },
};
export default config;
