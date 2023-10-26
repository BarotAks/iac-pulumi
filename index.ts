import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as crypto from "crypto";



// Load configurations
const config = new pulumi.Config("myfirstpulumi");
const awsConfig = new pulumi.Config("aws");


// Get the AWS profile from the config
// Get the AWS profile from the config
const awsProfile = awsConfig.require("profile");

// Get AWS region from configuration
const region =  awsConfig.require("region") as aws.Region

const vpcName = config.require("vpcName");
const publicCidrBlockName = config.require("publicCidrBlockName");
const internetGatewayName = config.require("internetGatewayName");
const publicRouteTableName = config.require("publicRouteTableName");
const privateRouteTableName = config.require("privateRouteTableName");
const subnetMask = config.require("subnetMask");
const vpcCidrBlock = config.require("vpcCidrBlock");
const amiId = config.require("amiId");
const keyPair = config.require("keyPair");
// Declare separate arrays for public and private subnets
const publicSubnets: aws.ec2.Subnet[] = [];
const privateSubnets: aws.ec2.Subnet[] = [];

function calculateCIDR(vpcCidrBlock: string, subnetIndex: number,  totalSubnets: number): string {
    const cidrParts = vpcCidrBlock.split('/');
    const ip = cidrParts[0].split('.').map(part => parseInt(part, 10));
    
    // Increment the third octet based on the subnet index
    ip[2] += subnetIndex;

    if (ip[2] > 255) {
        // Handle this case accordingly; in this example, we're throwing an error
        throw new Error('Exceeded the maximum number of subnets');
    }

    const subnetIp = ip.join('.');
    return `${subnetIp}/${subnetMask}`;  
}


// Configure AWS provider with the specified region
const provider = new aws.Provider("provider", {
    region: region,
    profile: awsProfile,
});

// Create a VPC
const vpc = new aws.ec2.Vpc(vpcName, {
    cidrBlock: vpcCidrBlock,
    tags: {
        Name: vpcName,
    },
}, { provider });


// Query the number of availability zones in the specified region
const azs = pulumi.output(aws.getAvailabilityZones());

// Create subnets dynamically based on the number of availability zones (up to 3)
const subnets = azs.apply((azs) =>
  azs.names.slice(0, 3).flatMap((az, index) => {
    const uniqueIdentifier = crypto.randomBytes(4).toString("hex"); // Generate a unique identifier
    const publicSubnetCidrBlock = calculateCIDR(
      vpcCidrBlock,
      index,
      3
    );
    const privateSubnetCidrBlock = calculateCIDR(
      vpcCidrBlock,
      index + 3,
      3
    );

// Create subnets dynamically based on the number of availability zones (up to 3)
    const publicSubnet = new aws.ec2.Subnet(`publicSubnet-${index}`, {
        vpcId: vpc.id,
        cidrBlock: publicSubnetCidrBlock,
        availabilityZone: az,
        mapPublicIpOnLaunch: true,
        tags: {
            Name: `PublicSubnet-${az}-${vpcName}-${uniqueIdentifier}`, 
        },
    }, { provider });

    const privateSubnet = new aws.ec2.Subnet(`privateSubnet-${index}`, {
        vpcId: vpc.id,
        cidrBlock: privateSubnetCidrBlock,
        availabilityZone: az,
        mapPublicIpOnLaunch: false,
        tags: {
            Name: `PrivateSubnet-${az}-${vpcName}-${uniqueIdentifier}`, 
        },
    }, { provider });

        // Pushing the subnets to their respective arrays
    publicSubnets.push(publicSubnet);
    privateSubnets.push(privateSubnet);

    return [publicSubnet, privateSubnet];
}));

// Create an Internet Gateway and attach it to the VPC
const internetGateway = new aws.ec2.InternetGateway(internetGatewayName, {
    vpcId: vpc.id,
    tags: {
        Name: internetGatewayName,  
    },
}, { provider });

// Create a Public Route Table with a route to the Internet Gateway
const publicRouteTable = new aws.ec2.RouteTable( publicRouteTableName, {
    vpcId: vpc.id,
    tags: {
        Name:  publicRouteTableName,  
    },
    routes: [{
        cidrBlock: publicCidrBlockName,
        gatewayId: internetGateway.id,
    }],
}, { provider });

// Associate each public subnet with the Public Route Table
subnets.apply(subnetArray => 
    subnetArray.filter((_, index) => index % 2 === 0)
    .forEach(subnet => 
        subnet.id.apply(id => 
            new aws.ec2.RouteTableAssociation(`publicRtAssoc-${id}`, {
                subnetId: id,
                routeTableId: publicRouteTable.id,
            }, { provider })
        )
    )
);

// Create a Private Route Table 
const privateRouteTable = new aws.ec2.RouteTable( privateRouteTableName, {
    vpcId: vpc.id,
    tags: {
        Name:  privateRouteTableName,  
    },
}, { provider });

// Associate each private subnet with the Private Route Table
subnets.apply(subnetArray => 
    subnetArray.filter((_, index) => index % 2 !== 0)
    .forEach(subnet => 
        subnet.id.apply(id => 
            new aws.ec2.RouteTableAssociation(`privateRtAssoc-${id}`, {
                subnetId: id,
                routeTableId: privateRouteTable.id,
                // You can add tags here as well if needed
            }, { provider })
        )
    )
);

// Create an EC2 security group for web applications
const appSecurityGroup = new aws.ec2.SecurityGroup("app-sg", {
    vpcId: vpc.id,
    description: "Application Security Group",
    ingress: [
        // Allow SSH (22) traffic 
        {
            protocol: "tcp",
            fromPort: 22,
            toPort: 22,
            cidrBlocks: [publicCidrBlockName]
        },
        // Allow HTTP (80) traffic
        {
            protocol: "tcp",
            fromPort: 80,
            toPort: 80,
            cidrBlocks: [publicCidrBlockName]
        },
        // Allow HTTPS (443) traffic 
        {
            protocol: "tcp",
            fromPort: 443,
            toPort: 443,
            cidrBlocks:[publicCidrBlockName]
        },
        // Replace 3000 with the port your application runs on
        {
            protocol: "tcp",
            fromPort: 3000,
            toPort: 3000,
            cidrBlocks: [publicCidrBlockName]
        }
    ],
    egress: [
        // Allow all outgoing traffic
        {
            protocol: "-1",
            fromPort: 0,
            toPort: 0,
            cidrBlocks: [publicCidrBlockName]
        }
    ],
});

// Export the IDs of the resources created
export const vpcId = vpc.id;
export const publicSubnetIds = subnets.apply(subnets => 
    subnets.filter((_, index) => index % 2 === 0).map(subnet => subnet.id)
);
export const privateSubnetIds = subnets.apply(subnets => 
    subnets.filter((_, index) => index % 2 !== 0).map(subnet => subnet.id)
);

// Create RDS parameter group
const dbParameterGroup = new aws.rds.ParameterGroup("db-parameter-group", {
    family: "mariadb10.4", // Specify your database family
    parameters: {
        // Define your custom parameters here if necessary
    },
});

// Create RDS instance (MariaDB)
const rdsInstance = new aws.rds.Instance("mydb", {
    allocatedStorage: 20,
    storageType: "gp2",
    engine: "mariadb",
    engineVersion: "10.4", // Specify your desired MariaDB version
    instanceClass: "db.t2.micro", // Use the appropriate instance class
    name: "csye6225", // Database name
    username: "csye6225",
    password: "Pass1234", // Replace with a strong password
    skipFinalSnapshot: true,
    publiclyAccessible: false,
    vpcSecurityGroupIds: [appSecurityGroup.id],
    allocatedStorage: 20,
    storageType: "gp2",
    dbSubnetGroupName: dbSubnetGroup.name,
    skipFinalSnapshot: true,
    parameterGroupName: dbParameterGroup.name,
});

// Security Group Rules: Allow EC2 to connect to MariaDB
appSecurityGroup.createIngressRule("allow-db", {
    type: "ingress",
    fromPort: 3306,
    toPort: 3306,
    protocol: "tcp",
    cidrBlocks: [aws.ec2.getPrivateIp({})], // Get private IP of EC2 instance
});


// Create an EC2 instance with User Data and Systemd Unit Setup
const ec2Instance = new aws.ec2.Instance("web-app-instance", {
    ami: "ami-00e5b41d2127eabf5",
    instanceType: "t2.micro",
    vpcSecurityGroupIds: [appSecurityGroup.id],
    subnetId: pulumi.output(publicSubnetIds[0]),
    associatePublicIpAddress: true,
    keyName: keyPair,
    disableApiTermination: false,
    rootBlockDevice: {
        deleteOnTermination: true,
        volumeSize: 25,
        volumeType: "gp2",
    },
    userData: pulumi.interpolate `#!/bin/bash
        export DB_HOSTNAME=${rdsInstance.endpoint};
        export DB_USERNAME=csye6225;
        export DB_PASSWORD=<YOUR_DB_PASSWORD>; // Replace with your MariaDB password
        # Additional configuration and startup commands for your application
        # ...
        # Start your application here
    `,
    tags: {
        Name: "web-app-instance",
    },
}, { dependsOn: publicSubnets });

// Systemd Unit Setup
const systemdServiceUnit = new aws.ec2.CloudInit("systemd-service", {
    instanceId: ec2Instance.id,
    userDataBase64: ec2Instance.userData.apply(userData => 
        Buffer.from(userData).toString("base64")),
});

// Output RDS endpoint and EC2 public IP
export const rdsEndpoint = rdsInstance.endpoint;
export const ec2PublicIp = ec2Instance.publicIp;

// Export the security group ID, internet gateway ID, route table IDs, and public IP
export const securityGroupId = appSecurityGroup.id;
export const internetGatewayId = internetGateway.id;
export const publicRouteTableId = publicRouteTable.id;
export const privateRouteTableId = privateRouteTable.id;
export const publicIp = ec2Instance.publicIp;
