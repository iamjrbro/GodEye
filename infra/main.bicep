targetScope = 'resourceGroup'

@description('Prefixo dos recursos (3-18 caracteres, letras minúsculas e números).')
@minLength(3)
@maxLength(18)
param name string = 'godeye'
param location string = resourceGroup().location
param adminUsername string = 'godeyeadmin'
@description('Chave pública SSH; nunca informe a chave privada.')
param sshPublicKey string
@description('CIDR do IP administrativo autorizado a usar SSH, por exemplo 203.0.113.10/32. Não use * ou 0.0.0.0/0.')
param sshSourceCidr string
param vmSize string = 'Standard_B2s'

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${name}-nsg'
  location: location
  properties: {
    securityRules: [
      { name: 'https', properties: { priority: 100, direction: 'Inbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: '*', sourcePortRange: '*', destinationAddressPrefix: '*', destinationPortRange: '443' } }
      { name: 'http-acme', properties: { priority: 110, direction: 'Inbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: '*', sourcePortRange: '*', destinationAddressPrefix: '*', destinationPortRange: '80' } }
      { name: 'ssh-admin', properties: { priority: 120, direction: 'Inbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: sshSourceCidr, sourcePortRange: '*', destinationAddressPrefix: '*', destinationPortRange: '22' } }
    ]
  }
}
resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${name}-vnet'
  location: location
  properties: {
    addressSpace: { addressPrefixes: ['10.40.0.0/16'] }
    subnets: [ { name: 'app', properties: { addressPrefix: '10.40.1.0/24', networkSecurityGroup: { id: nsg.id } } } ]
  }
}
resource publicIp 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${name}-ip'
  location: location
  sku: { name: 'Standard' }
  properties: { publicIPAllocationMethod: 'Static' }
}
resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: '${name}-nic'
  location: location
  properties: {
    ipConfigurations: [ { name: 'primary', properties: { privateIPAllocationMethod: 'Dynamic', subnet: { id: '${vnet.id}/subnets/app' }, publicIPAddress: { id: publicIp.id } } } ]
  }
}
resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: name
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    hardwareProfile: { vmSize: vmSize }
    storageProfile: {
      imageReference: { publisher: 'Canonical', offer: 'ubuntu-24_04-lts', sku: 'server', version: 'latest' }
      osDisk: { createOption: 'FromImage', deleteOption: 'Detach', diskSizeGB: 64, managedDisk: { storageAccountType: 'StandardSSD_LRS' } }
    }
    osProfile: {
      computerName: name
      adminUsername: adminUsername
      linuxConfiguration: {
        disablePasswordAuthentication: true
        provisionVMAgent: true
        patchSettings: { patchMode: 'AutomaticByPlatform', assessmentMode: 'AutomaticByPlatform' }
        ssh: { publicKeys: [ { path: '/home/${adminUsername}/.ssh/authorized_keys', keyData: sshPublicKey } ] }
      }
    }
    networkProfile: { networkInterfaces: [ { id: nic.id } ] }
    securityProfile: { securityType: 'TrustedLaunch', uefiSettings: { secureBootEnabled: true, vTpmEnabled: true } }
  }
}
output publicIpAddress string = publicIp.properties.ipAddress
output vmResourceId string = vm.id
