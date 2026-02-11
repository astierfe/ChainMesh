/**
 * Minimal ABIs for GenericCache and GenericOracle contracts.
 * Only includes functions the SDK needs to call.
 */

export const GENERIC_CACHE_ABI = [
  'function getData(bytes32 key) external view returns (bytes memory value, bool isFromCache, bool needsUpdate)',
  'function requestData(bytes32 key, bytes32 schemaHash) external payable returns (bytes32 messageId)',
  'function getDefaultValue(bytes32 schemaHash) external view returns (bytes memory)',
  'function CACHE_TTL() external view returns (uint256)',
  'function MIN_REQUEST_INTERVAL() external view returns (uint256)',
  'event DataQueried(bytes32 indexed key, bytes32 indexed schemaHash, address indexed requester, bytes32 messageId)',
  'event DataCached(bytes32 indexed key, bytes32 indexed schemaHash, uint256 expiryTime)',
  'event CacheHit(bytes32 indexed key, bytes32 schemaHash, bool isFresh)',
  'event CacheMiss(bytes32 indexed key, bytes32 schemaHash)',
] as const;

export const GENERIC_ORACLE_ABI = [
  'function getData(bytes32 key) external view returns (bytes memory value, uint32 timestamp, bytes32 schemaHash, bool isValid)',
  'event DataUpdated(bytes32 indexed key, bytes32 indexed schemaHash, uint256 timestamp)',
  'event QueryReceived(bytes32 indexed messageId, bytes32 indexed key, bytes32 indexed schemaHash, uint64 sourceChain, address requester)',
] as const;
