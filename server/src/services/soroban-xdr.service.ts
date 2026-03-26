import { xdr, Address, nativeToScVal } from '@stellar/stellar-sdk';

/**
 * SorobanXdrService
 * Utility to map JavaScript types to Soroban SCVal and build InvokeHostFunction XDRs.
 */
export class SorobanXdrService {
    /**
     * Builds an SCVal for common data types.
     */
    mapToScVal(value: any): xdr.ScVal {
        if (typeof value === 'string' && (value.startsWith('G') || value.startsWith('C'))) {
            return nativeToScVal(Address.fromString(value));
        }
        return nativeToScVal(value);
    }

    /**
     * Builds an InvokeHostFunction XDR string for a contract call.
     */
    buildInvokeXDR(contractId: string, functionName: string, args: any[] = []): string {
        try {
            const scArgs = args.map(arg => this.mapToScVal(arg));

            const invokeHostFunctionOp = xdr.HostFunction.hostFunctionTypeInvokeContract(
                new xdr.InvokeContractArgs({
                    contractAddress: Address.fromString(contractId).toScAddress(),
                    functionName: xdr.ScSymbol.fromXDR(Buffer.from(functionName, 'utf8')),
                    args: scArgs
                })
            );

            return invokeHostFunctionOp.toXDR('base64');
        } catch (error: any) {
            try {
                const invokeHostFunctionOp = xdr.HostFunction.hostFunctionTypeInvokeContract(
                    new xdr.InvokeContractArgs({
                        contractAddress: Address.fromString(contractId).toScAddress(),
                        functionName: xdr.ScSymbol.fromXDR(Buffer.from(functionName, 'utf8')),
                        args: args.map(arg => this.mapToScVal(arg))
                    })
                );
                return invokeHostFunctionOp.toXDR('base64');
            } catch (innerError) {
                console.error(`XDR Build failed for ${contractId}.${functionName}:`, error.message);
                throw new Error('Failed to build Soroban contract invoke XDR.');
            }
        }
    }
}

export default new SorobanXdrService();
