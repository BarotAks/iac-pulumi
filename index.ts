import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

interface VpcConfig {
    cidrBlock: string;
    availabilityZones: string[];
}

function createVpc(config: VpcConfig): aws.ec2.Vpc {
    return new aws.ec2.Vpc("my-vpc", {
        cidrBlock: config.cidrBlock,
        enableDnsSupport: true,
        enableDnsHostnames: true,
        tags: {
            Name: "MyVPC",
        },
    });
}

function createInternetGateway(vpcId: pulumi.Output<string>): aws.ec2.InternetGateway {
    return new aws.ec2.InternetGateway("myInternetGateway", {
        vpcId: vpcId,
        tags: {
            Name: "MyInternetGateway",
        },
    });
}

function createSubnets(vpcId: pulumi.Output<string>, availabilityZones: string[], isPublic: boolean): aws.ec2.Subnet[] {
    const subnets: aws.ec2.Subnet[] = [];

    if (availabilityZones && availabilityZones.length > 0) {
        availabilityZones.forEach((az, index) => {
            const subnet = new aws.ec2.Subnet(`subnet-${isPublic ? 'public' : 'private'}-${index + 1}`, {
                vpcId: vpcId,
                availabilityZone: az,
                cidrBlock: `10.0.${isPublic ? '1' : '2'}.${index * 16}/28`,
                mapPublicIpOnLaunch: isPublic,
                tags: {
                    Name: `My ${isPublic ? 'public' : 'private'} subnet ${index + 1}`,
                },
            });
            subnets.push(subnet);
        });
    } else {
        console.error("Availability zones are not defined or empty.");
    }

    return subnets;
}

function createRouteTable(vpcId: pulumi.Output<string>, subnets: aws.ec2.Subnet[], isPublic: boolean, internetGateway: aws.ec2.InternetGateway): aws.ec2.RouteTable {
    const routeTable = new aws.ec2.RouteTable(`route-table-${isPublic ? 'public' : 'private'}`, {
        vpcId: vpcId,
        tags: {
            Name: `My ${isPublic ? 'public' : 'private'} route table`,
        },
    });

    if (subnets && subnets.length > 0) {
        subnets.forEach((subnet, index) => {
            new aws.ec2.RouteTableAssociation(`subnet-assoc-${isPublic ? 'public' : 'private'}-${index}`, {
                subnetId: subnet.id,
                routeTableId: routeTable.id,
            });
        });
    } else {
        console.error("Subnets are not defined or empty.");
    }

    return routeTable;
}

const config = new pulumi.Config();
const vpcConfig: VpcConfig = config.requireObject("vpc");

const vpc = createVpc(vpcConfig);
const internetGateway = createInternetGateway(vpc.id);
const publicSubnets = createSubnets(vpc.id, vpcConfig.availabilityZones, true);
const privateSubnets = createSubnets(vpc.id, vpcConfig.availabilityZones, false);
const routeTablePublic = createRouteTable(vpc.id, publicSubnets, true, internetGateway);

export const vpcId = vpc.id;
export const publicSubnetIds = publicSubnets.map(subnet => subnet.id);
export const privateSubnetIds = privateSubnets.map(subnet => subnet.id);
