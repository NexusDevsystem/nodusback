// AbacatePay service deactivated
export class AbacateService {
    static async createBilling(options: any): Promise<any> {
        throw new Error('AbacatePay desativado.');
    }
    static async listBillings(): Promise<any[]> {
        return [];
    }
}
