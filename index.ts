import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
// import * as awsx from "@pulumi/awsx";


// // Create an AWS resource (S3 Bucket)
// const bucket = new aws.s3.Bucket("my-bucket");

// // Export the name of the bucket
// export const bucketName = bucket.id;

const config = new pulumi.Config();
const region = config.require("config:aws:region");
const vpcConfig = config.requireObject("config:vpc");

const vpc = new aws.ec2.Vpc("my-vpc", {
    cidrBlock: vpcConfig.cidrBlock,
    enableDnsSupport: true,
    enableDnsHostnames: true,
    tags: {
        Name: "MyVPC",
    },
});

const createSubnets = (vpcId: string, availabilityZones: string[], isPublic: boolean) => {
    const subnets: aws.ec2.Subnet[] = [];

    for (let i = 0; i < availabilityZones.length; i++) {
        const subnet = new aws.ec2.Subnet(`subnet-${isPublic ? 'public' : 'private'}-${i + 1}`, {
            vpcId: vpcId,
            availabilityZone: availabilityZones[i],
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

const publicSubnets = createSubnets(vpc.id, vpcConfig.availabilityZones, true);
const privateSubnets = createSubnets(vpc.id, vpcConfig.availabilityZones, false);

const internetGateway = new aws.ec2.InternetGateway("igw", {
    vpcId: vpc.id,
    tags: {
        Name: "MyInternetGateway",
    },
});

const createRouteTable = (subnets: aws.ec2.Subnet[], isPublic: boolean) => {
    const routeTable = new aws.ec2.RouteTable(`route-table-${isPublic ? 'public' : 'private'}`, {
        vpcId: vpc.id,
        tags: {
            Name: `My ${isPublic ? 'public' : 'private'} route table`,
        },
    });

    const route = new aws.ec2.Route(`route-${isPublic ? 'public' : 'private'}`, {
        routeTableId: routeTable.id,
        destinationCidrBlock: "0.0.0.0/0",
        gatewayId: isPublic ? internetGateway.id : undefined,
    });

    subnets.forEach((subnet, index) => {
        new aws.ec2.RouteTableAssociation(`subnet-assoc-${isPublic ? 'public' : 'private'}-${index}`, {
            subnetId: subnet.id,
            routeTableId: routeTable.id,
        });
    });

    return routeTable;
};

const publicRouteTable = createRouteTable(publicSubnets, true);
const privateRouteTable = createRouteTable(privateSubnets, false);

export const vpcId = vpc.id;
export const publicSubnetIds = publicSubnets.map(subnet => subnet.id);
export const privateSubnetIds = privateSubnets.map(subnet => subnet.id);
