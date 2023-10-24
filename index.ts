import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

interface VpcConfig {
    cidrBlock: string;
}

async function createVpc(config: VpcConfig): Promise<aws.ec2.Vpc> {
    const vpc = new aws.ec2.Vpc("my-vpc", {
        cidrBlock: config.cidrBlock,
        enableDnsSupport: true,
        enableDnsHostnames: true,
        tags: {
            Name: "MyVPC",
        },
    });

    return vpc;
}

const config = new pulumi.Config();
const vpcConfig: VpcConfig = {
    cidrBlock: config.require("vpcCidrBlock"),
};

const vpc = createVpc(vpcConfig);

const availabilityZones = await aws.getAvailabilityZones({
    state: "available",
});

const numAZs = availabilityZones.names.length;

const createSubnets = (vpcId: pulumi.Output<string>, isPublic: boolean): aws.ec2.Subnet[] => {
    const subnets: aws.ec2.Subnet[] = [];

    for (let i = 0; i < numAZs; i++) {
        const subnet = new aws.ec2.Subnet(`subnet-${isPublic ? 'public' : 'private'}-${i + 1}`, {
            vpcId: vpcId,
            availabilityZone: availabilityZones.names[i],
            cidrBlock: `10.0.${isPublic ? '1' : '2'}.${i * 16}/28`,
            mapPublicIpOnLaunch: isPublic,
            tags: {
                Name: `My ${isPublic ? 'public' : 'private'} subnet ${i + 1}`,
            },
        });
        subnets.push(subnet);
    }

    return subnets;
};

const publicSubnets = createSubnets(vpc.id, true);
const privateSubnets = createSubnets(vpc.id, false);

const appSecurityGroup = new aws.ec2.SecurityGroup("app-security-group", {
    vpcId: vpc.id,
    ingress: [
        {
            protocol: "tcp",
            fromPort: 22,
            toPort: 22,
            cidrBlocks: ["0.0.0.0/0"], // Allow SSH from anywhere
        },
        {
            protocol: "tcp",
            fromPort: 80,
            toPort: 80,
            cidrBlocks: ["0.0.0.0/0"], // Allow HTTP from anywhere
        },
        {
            protocol: "tcp",
            fromPort: 443,
            toPort: 443,
            cidrBlocks: ["0.0.0.0/0"], // Allow HTTPS from anywhere
        },
        {
            protocol: "tcp",
            fromPort: 4000, // Allow traffic on port 4000 (application port)
            toPort: 4000, // Allow traffic on port 4000 (application port)
            cidrBlocks: ["0.0.0.0/0"], // Allow traffic on port 4000 from anywhere
        },
    ],
    egress: [
        {
            protocol: "-1",
            fromPort: 0,
            toPort: 0,
            cidrBlocks: ["0.0.0.0/0"], // Allow all outbound traffic
        },
    ],
    tags: {
        Name: "AppSecurityGroup",
    },
});

const instance = new aws.ec2.Instance("my-instance", {
    ami: "ami-0e7850184e9e201bd", // Replace with your custom AMI ID
    instanceType: "t2.micro", // Specify the desired instance type
    subnetId: privateSubnets[0].id, // Launch in the first private subnet
    securityGroups: [appSecurityGroup.name], // Attach the application security group
    rootBlockDevice: {
        volumeSize: 25,
        volumeType: "gp2",
        deleteOnTermination: true,
    },
    disableApiTermination: false,
    tags: {
        Name: "MyEC2Instance",
    },
});

export const vpcId = vpc.id;
export const publicSubnetIds = publicSubnets.map(subnet => subnet.id);
export const privateSubnetIds = privateSubnets.map(subnet => subnet.id);
export const publicRouteTableId = publicRouteTable.id;
export const privateRouteTableId = privateRouteTable.id;
export const appSecurityGroupId = appSecurityGroup.id;
export const instanceId = instance.id;

