import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as crypto from "crypto";
import * as alb from "@pulumi/aws/alb";
import * as route53 from "@pulumi/aws/route53";
import * as gcp from "@pulumi/gcp";
import * as mailgun from "@pulumi/mailgun";

// Load configurations
const config = new pulumi.Config("myfirstpulumi");
const awsConfig = new pulumi.Config("aws");

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
const rdsName = config.require("identifier");
const intClass = config.require("instanceClass");
const engVersion = config.require("engineVersion");
const storageType = config.require("storageType");
const eng = config.require("engine");
const databaseName = config.require("dbName");
const parameterGroupName = config.require("parameterGroupName");
const dbUsername = config.requireSecret("dbUsername");
const dbPassword = config.requireSecret("dbPassword");
const domainName = config.require("domainName");
const hostedZoneId = config.require("hostedZoneId");

// Define Mailgun configuration
const mailgunDomain = config.require("mailgunDomain");
const mailgunApiKey = config.requireSecret("mailgunApiKey");
const mailgunSenderEmail = config.require("mailgunSenderEmail");

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

// // Create an EC2 security group for web applications
// const appSecurityGroup = new aws.ec2.SecurityGroup("app-sg", {
//     vpcId: vpc.id,
//     description: "Application Security Group",
//     ingress: [
//         // Allow SSH (22) traffic 
//         {
//             protocol: "tcp",
//             fromPort: 22,
//             toPort: 22,
//             cidrBlocks: [publicCidrBlockName]
//         },
//         // Allow HTTP (80) traffic
//         {
//             protocol: "tcp",
//             fromPort: 80,
//             toPort: 80,
//             cidrBlocks: [publicCidrBlockName]
//         },
//         // Allow HTTPS (443) traffic 
//         {
//             protocol: "tcp",
//             fromPort: 443,
//             toPort: 443,
//             cidrBlocks:[publicCidrBlockName]
//         },
//         // Replace 3000 with the port your application runs on
//         {
//             protocol: "tcp",
//             fromPort: 3000,
//             toPort: 3000,
//             cidrBlocks: [publicCidrBlockName]
//         }
//     ],
//     egress: [
//         // Allow all outgoing traffic
//         {
//             protocol: "-1",
//             fromPort: 0,
//             toPort: 0,
//             cidrBlocks: [publicCidrBlockName]
//         }
//     ],
// });

// Create Load Balancer Security Group
const lbSecurityGroup = new aws.ec2.SecurityGroup("lb-sg", {
    vpcId: vpc.id,
    description: "Load Balancer Security Group",
    ingress: [
        // Allow HTTP (80) traffic from anywhere
        {
            protocol: "tcp",
            fromPort: 80,
            toPort: 80,
            cidrBlocks: ["0.0.0.0/0"]
        },
        // Allow HTTPS (443) traffic from anywhere
        {
            protocol: "tcp",
            fromPort: 443,
            toPort: 443,
            cidrBlocks: ["0.0.0.0/0"]
        },
    ],
    egress: [
        // Allow all outgoing traffic
        {
            protocol: "-1",
            fromPort: 0,
            toPort: 0,
            cidrBlocks: ["0.0.0.0/0"]
        }
    ],
});

const appSecurityGroup = new aws.ec2.SecurityGroup("app-sg", {
    vpcId: vpc.id,
    description: "Application Security Group",
    ingress: [
        // Allow SSH (22) traffic
        {
            protocol: "tcp",
            fromPort: 22,
            toPort: 22,
            securityGroups: [lbSecurityGroup.id]
        },
        // Allow your application port (replace 3000 with your actual application port)
        {
            protocol: "tcp",
            fromPort: 3000,
            toPort: 3000,
            securityGroups: [lbSecurityGroup.id]
        },
    ],
    egress: [
        // Allow all outgoing traffic
        {
            protocol: "-1",
            fromPort: 0,
            toPort: 0,
            cidrBlocks: ["0.0.0.0/0"]
        }
    ],
});

appSecurityGroup.ingress.apply(ingress => [
    // Remove existing HTTP and HTTPS rules
    ...ingress.filter(rule => rule.fromPort !== 80 && rule.fromPort !== 443),
    // Add the new rules for SSH and your application port
    {
        protocol: "tcp",
        fromPort: 22,
        toPort: 22,
        securityGroups: [lbSecurityGroup.id]
    },
    {
        protocol: "tcp",
        fromPort: 3000, // Replace with your application port
        toPort: 3000,   // Replace with your application port
        securityGroups: [lbSecurityGroup.id]
    },
]);


// // Update App Security Group
// appSecurityGroup.ingress.apply(ingress => [
//     ...ingress,
//     // Allow TCP traffic on ports 22 and your application port from the load balancer security group
//     {
//         protocol: "tcp",
//         fromPort: 22,
//         toPort: 22,
//         securityGroups: [lbSecurityGroup.id]
//     },
//     // {
//     //     protocol: "tcp",
//     //     fromPort: 3000, // Replace with your application port
//     //     toPort: 3000,   // Replace with your application port
//     //     securityGroups: [lbSecurityGroup.id]
//     // },
// ]);

// // Restrict access to the instance from the internet
// appSecurityGroup.ingress.apply(ingress => [
//     ...ingress.filter(rule => rule.fromPort !== 80 && rule.fromPort !== 443),  // Remove existing HTTP and HTTPS rules
//     // {
//     //     protocol: "tcp",
//     //     fromPort: 80,
//     //     toPort: 80,
//     //     cidrBlocks: ["0.0.0.0/0"],
//     //     // Uncomment the line below to restrict access to the instance from the internet
//     //     revoke: true
//     // },
//     // {
//     //     protocol: "tcp",
//     //     fromPort: 443,
//     //     toPort: 443,
//     //     cidrBlocks: ["0.0.0.0/0"],
//     //     // Uncomment the line below to restrict access to the instance from the internet
//     //     revoke: true
//     // },
// ]);


// Export the ID of the load balancer security group
export const lbSecurityGroupId = lbSecurityGroup.id;

// Create an EC2 security group for RDS instances
const rdsSecurityGroup = new aws.ec2.SecurityGroup("rds-sg", {
    vpcId: vpc.id,
    description: "RDS Security Group",
    ingress: [
        // Allow MySQL/MariaDB (3306) traffic or PostgreSQL (5432) traffic from the application security group
        {
            protocol: "tcp",
            fromPort: 3306,  
            toPort: 3306,    
            securityGroups: [appSecurityGroup.id]  // Only allows traffic from the application security group
        }
    ],
    egress: [
        // Restrict all outgoing internet traffic
        {
            protocol: "tcp",
            fromPort: 0,
            toPort: 0,
            cidrBlocks: [publicCidrBlockName]
            
        }
    ],
}, { provider });

// Define a simple IAM instance profile name
// const iamInstanceProfileName = "MyInstanceProfile";

const customRole = new aws.iam.Role("custom-role", {
    name: "MyInstanceProfile", // Use the defined IAM instance profile name
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: {
                Service: "ec2.amazonaws.com"
            }
        }]
    }),
});

// Attach the CloudWatchAgentServerPolicy managed policy
const cloudWatchPolicyAttachment = new aws.iam.PolicyAttachment("cloudwatch-policy-attachment", {
    roles: [customRole.name],
    policyArn: "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
});

const iamInstanceProfile = new aws.iam.InstanceProfile("my-instance-profile", {
    role: customRole.name,
});


// Export the IDs of the resources created
export const vpcId = vpc.id;
export const publicSubnetIds = subnets.apply(subnets => 
    subnets.filter((_, index) => index % 2 === 0).map(subnet => subnet.id)
);
export const privateSubnetIds = subnets.apply(subnets => 
    subnets.filter((_, index) => index % 2 !== 0).map(subnet => subnet.id)
);

const dbParameterGroup = new aws.rds.ParameterGroup(parameterGroupName, {
    family: "mariadb10.5",
    description: "Custom parameter group for mariadb10.5",
    parameters: [{
        name: "max_connections",
        value: "100"
    }]
}, { provider });

// Creating a DB subnet group
const dbSubnetGroup = new aws.rds.SubnetGroup("dbsubnetgrp", {
    subnetIds: privateSubnetIds,
    tags: {
        Name: "dbsubnetgrp",
    },
}, { provider });

// Create an RDS instance with MariaDB
const dbInstance = new aws.rds.Instance("mydbinstance", {
    instanceClass: intClass,
    dbSubnetGroupName: dbSubnetGroup.name, 
    parameterGroupName: dbParameterGroup.name, 
    engine: eng,
    engineVersion: engVersion, 
    allocatedStorage: 20,
    storageType: storageType,
    username: dbUsername,
    password: dbPassword,
    skipFinalSnapshot: true,
    vpcSecurityGroupIds: [rdsSecurityGroup.id],
    publiclyAccessible: false,
    identifier: rdsName,
    dbName: databaseName

}, { provider });

// const userData = pulumi.all([dbInstance.endpoint, dbUsername, dbPassword, databaseName]).apply(([endpoint, username, password, databaseName]) => {
//     const parts = endpoint.split(':');
//     const endpoint_host = parts[0];
//     const dbPort = parts[1];

//     // Create the bash script string
//     const userDataScript = `#!/bin/bash
// ENV_FILE="/home/admin/webapp/.env"

// # Create or overwrite the environment file with the environment variables
// echo "DB_HOST=${endpoint_host}" > $ENV_FILE
// echo "DBPORT=${dbPort}" >> $ENV_FILE
// echo "DB_USERNAME=${username}" >> $ENV_FILE
// echo "DB_PASSWORD=${password}" >> $ENV_FILE
// echo "DB_DATABASE=${databaseName}" >> $ENV_FILE
// echo "CSV_PATH=/home/admin/webapp/users.csv" >> $ENV_FILE
// echo "PORT=3000" >> $ENV_FILE

// # Optionally, you can change the owner and group of the file if needed
// sudo chown admin:admin $ENV_FILE

// # Adjust the permissions of the environment file
// sudo chmod 600 $ENV_FILE

// # Fetch configurations using CloudWatch Agent
// sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
//   -a fetch-config \
//   -m ec2 \
//   -c file:/home/admin/webapp/packer/cloudwatch-config.json \
//   -s

// # Restart the application service
// # sudo systemctl restart webapp.service
// `;

//     // Encode the user data using base64
//     const base64EncodedUserData = Buffer.from(userDataScript).toString('base64');

//     return base64EncodedUserData;
// });

// Create an SNS topic
const snsTopic = new aws.sns.Topic("webAppSnsTopic", {
    displayName: "WebAppSnsTopic",
});

// Get the ARN of the SNS topic
const snsTopicArn = snsTopic.arn;

// Update the user data script to include SNS topic information
const userData = pulumi.all([
    dbInstance.endpoint,
    dbUsername,
    dbPassword,
    databaseName,
    snsTopicArn, // Include SNS topic ARN in user data
]).apply(([endpoint, username, password, databaseName, snsTopicArn]) => {
    const parts = endpoint.split(':');
    const endpoint_host = parts[0];
    const dbPort = parts[1];

    // Create the bash script string
    const userDataScript = `#!/bin/bash
ENV_FILE="/home/admin/webapp/.env"

# Create or overwrite the environment file with the environment variables
echo "DB_HOST=${endpoint_host}" > $ENV_FILE
echo "DBPORT=${dbPort}" >> $ENV_FILE
echo "DB_USERNAME=${username}" >> $ENV_FILE
echo "DB_PASSWORD=${password}" >> $ENV_FILE
echo "DB_DATABASE=${databaseName}" >> $ENV_FILE
echo "SNS_TOPIC_ARN=${snsTopicArn}" >> $ENV_FILE // Include SNS topic ARN in the environment file
echo "CSV_PATH=/home/admin/webapp/users.csv" >> $ENV_FILE
echo "PORT=3000" >> $ENV_FILE

// Optionally, you can change the owner and group of the file if needed
sudo chown admin:admin $ENV_FILE

// Adjust the permissions of the environment file
sudo chmod 600 $ENV_FILE

// Fetch configurations using CloudWatch Agent
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -c file:/home/admin/webapp/packer/cloudwatch-config.json \
  -s

// Restart the application service
# sudo systemctl restart webapp.service
`;

    // Encode the user data using base64
    const base64EncodedUserData = Buffer.from(userDataScript).toString('base64');

    return base64EncodedUserData;
});


// Create an EC2 instance
const ec2Instance = new aws.ec2.Instance("web-app-instance", {
    ami: amiId,
    instanceType: "t2.micro",
    vpcSecurityGroupIds: [appSecurityGroup.id],  // attach application security group
    subnetId: publicSubnetIds[0].apply(id => id),    // specify one of the public subnets
    associatePublicIpAddress: true,
    keyName: keyPair, 
    disableApiTermination: false,  // allows the instance to be terminated
    rootBlockDevice: {
        deleteOnTermination: true,  // ensure the EBS volume is deleted upon termination
        volumeSize: 25, // set the root volume size to 25 GB
        volumeType: "gp2", // set the root volume type to General Purpose SSD (GP2)
    },
    tags: {
        Name: "web-app-instance",
    },
    iamInstanceProfile: iamInstanceProfile.name, // Use the defined IAM instance profile name
    userData: userData,
}, { dependsOn: publicSubnets}); 

// Get the public IP address of the EC2 instance
const ec2InstancePublicIp = ec2Instance.publicIp;

// // Create a Route53 Record Set for the domain
// const domainRecord = new aws.route53.Record(`${domainName}-record`, {
//     zoneId: hostedZoneId,
//     name: domainName,
//     type: "A",
//     ttl: 60,
//     records: [ec2InstancePublicIp],
// });

// Define Launch Template for EC2 instances
const launchTemplate = new aws.ec2.LaunchTemplate("web-app-launch-template", {
    imageId: amiId, // Your custom AMI
    instanceType: "t2.micro",
    keyName: keyPair,
    userData: userData,
    name: "csye6225_asg",  // Set the Launch Template Name
    // securityGroupNames: [appSecurityGroup.name], // WebAppSecurityGroup
    vpcSecurityGroupIds: [appSecurityGroup.id]
});

// Define Auto Scaling Group
const autoScalingGroup = new aws.autoscaling.Group("web-app-auto-scaling-group", {
    vpcZoneIdentifiers: pulumi.output(subnets).apply(subnets => subnets.map(subnet => subnet.id)),  // Pass the array directly
    cooldown: 60,  // Set the Cooldown to 60 seconds
    launchTemplate: {
        id: launchTemplate.id,
        version: "$Latest",
    },
    minSize: 1,
    maxSize: 3,
    desiredCapacity: 1,
    healthCheckType: "EC2",
    healthCheckGracePeriod: 300, // 300 seconds (default)
    forceDelete: true,
    tags: [
        {
            key: "Name",
            value: "web-app-instance",
            propagateAtLaunch: true,
        },
        // Add other tags as needed
        {
            key: "AutoScalingGroup",
            value: "csye6225_asg",  // Set the AutoScalingGroup tag property
            propagateAtLaunch: true,
        },
    ],
    waitForCapacityTimeout: "0s", // No waiting for capacity
}as any);


const scaleUpPolicy = new aws.autoscaling.Policy("web-app-scale-up-policy", {
    scalingAdjustment: 1,
    adjustmentType: "ChangeInCapacity",
    cooldown: 60,
    autoscalingGroupName: autoScalingGroup.name,  // Use autoscalingGroupName instead of autoScalingGroupName
});

const scaleDownPolicy = new aws.autoscaling.Policy("web-app-scale-down-policy", {
    scalingAdjustment: -1,
    adjustmentType: "ChangeInCapacity",
    cooldown: 60,
    autoscalingGroupName: autoScalingGroup.name,  // Use autoscalingGroupName instead of autoScalingGroupName
});


// Define CloudWatch alarms for scaling policies
const scaleUpAlarm = new aws.cloudwatch.MetricAlarm("web-app-scale-up-alarm", {
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 1,
    metricName: "CPUUtilization",
    namespace: "AWS/EC2",
    period: 60,
    threshold: 5,
    statistic: "Average",
    dimensions: {
        AutoScalingGroupName: autoScalingGroup.name,
    },
    alarmActions: [scaleUpPolicy.arn],
});

const scaleDownAlarm = new aws.cloudwatch.MetricAlarm("web-app-scale-down-alarm", {
    comparisonOperator: "LessThanThreshold",
    evaluationPeriods: 1,
    metricName: "CPUUtilization",
    namespace: "AWS/EC2",
    period: 60,
    threshold: 3,
    statistic: "Average",
    dimensions: {
        AutoScalingGroupName: autoScalingGroup.name,
    },
    alarmActions: [scaleDownPolicy.arn],
});

// Create an Application Load Balancer
const loadBalancer = new aws.lb.LoadBalancer("web-app-lb", {
    internal: false,
    loadBalancerType: "application",
    securityGroups: [lbSecurityGroup.id],
    enableDeletionProtection: false,
    subnets: pulumi
        .output(subnets)
        .apply(subnets => subnets.filter((_, index) => index % 2 === 0).map(subnet => subnet.id)), // Select subnets from different Availability Zones
});

const availabilityZones = pulumi.output(subnets).apply(subnets => subnets.map(subnet => subnet.availabilityZone));

// Create a target group for the auto-scaling group
const targetGroup = new aws.lb.TargetGroup("web-app-target-group", {
    port: 3000,
    protocol: "HTTP",
    targetType: "instance",
    vpcId: vpc.id,
    healthCheck: {
        path: "/",
        port: "traffic-port",
    },
    // targets: pulumi.output(availabilityZones).apply(azs =>
    //     azs.map((az, index) => ({
    //         targetId: pulumi.interpolate`web-app-auto-scaling-group-${index + 1}`,
    //         availabilityZone: az,
    //     }))
    // ),
});


// Attach the target group to the auto-scaling group
const attachment = new aws.lb.TargetGroupAttachment("web-app-target-group-attachment", {
    targetGroupArn: targetGroup.arn,
    targetId: ec2Instance.id, // Use a valid EC2 instance ID here
});

// Create an ALB listener to forward traffic to the target group
const listener = new aws.lb.Listener("web-app-listener", {
    loadBalancerArn: loadBalancer.arn,
    port: 80,
    defaultActions: [
        {
            type: "forward",
            targetGroupArn: targetGroup.arn,
        },
    ],
});


// // Create an ALB listener to forward traffic to the target group
// const listener = new aws.lb.Listener("web-app-listener", {
//     loadBalancerArn: loadBalancer.arn,
//     port: 80,
//     defaultActions: [
//         {
//             type: "fixed-response",
//             fixedResponse: {
//                 contentType: "text/plain",
//                 statusCode: "200",
//                 messageBody: "OK",
//             },
//         },
//     ],
// });

// Update Route53 record to point to the ALB
// const albRecord = new aws.route53.Record("alb-record", {
//     zoneId: hostedZoneId,
//     name: domainName,
//     type: "A",
//     // ttl: 60,
//     records: [loadBalancer.dnsName],  // Add this line to provide the records
//     aliases: [{
//         evaluateTargetHealth: true,
//         name: loadBalancer.dnsName,
//         zoneId: loadBalancer.zoneId,
//     }],
// });

const albRecord = new aws.route53.Record("alb-record", {
    zoneId: hostedZoneId,
    name: domainName,
    type: "A",
    aliases: [{
        evaluateTargetHealth: true,
        name: loadBalancer.dnsName,
        zoneId: loadBalancer.zoneId,
    }],
});


// Export the ALB DNS name
export const albDnsName = loadBalancer.dnsName;

// // Attach the EC2 instances to the Target Group
// const webAppTargetGroupAttachment = new alb.TargetGroupAttachment("web-app-tg-attachment", {
//     targetGroupArn: webAppTargetGroup.arn,
//     targetId: ec2Instance.id,
//     port: 3000,
// });

// // Update Route53 to point to the ALB
// const domainRecord = new route53.Record("web-app-dns", {
//     zoneId: hostedZoneId,
//     name: domainName,
//     type: "A",
//     ttl: pulumi.output(60).apply(v => parseInt(v, 10)),  // Convert string to number
//     aliases: [{
//         evaluateTargetHealth: true,
//         name: webAppLoadBalancer.dnsName,
//         zoneId: webAppLoadBalancer.zoneId,
//     }],
// });

// Create a Google Cloud Storage bucket
const gcsBucket = new gcp.storage.Bucket("my-gcs-bucket", {
    location: "US",
    storageClass: "STANDARD",
});

// Create a Google Service Account
const serviceAccount = new gcp.serviceaccount.Account("my-service-account", {
    accountId: "my-service-account", // Unique identifier for the service account
    displayName: "My Service Account",
});

// Create Access Keys for the Google Service Account
const serviceAccountKey = new gcp.serviceaccount.Key("my-service-account-key", {
    serviceAccountId: serviceAccount.accountId,
});

// Create a DynamoDB table
const dynamoDBTable = new aws.dynamodb.Table("my-dynamodb-table", {
    attributes: [
        {
            name: "id",
            type: "S",
        },
    ],
    hashKey: "id",
    readCapacity: 1,
    writeCapacity: 1,
});

// Define IAM Role for Lambda Function
const lambdaRole = new aws.iam.Role("lambdaRole", {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
            {
                Action: "sts:AssumeRole",
                Effect: "Allow",
                Principal: {
                    Service: "lambda.amazonaws.com",
                },
            },
        ],
    }),
});

// Define IAM Policy for DynamoDB Access
const dynamoDBPolicy = new aws.iam.Policy("dynamoDBPolicy", {
    policy: {
        Version: "2012-10-17",
        Statement: [
            {
                Action: [
                    "dynamodb:Scan",
                    "dynamodb:Query",
                    "dynamodb:GetItem",
                    "dynamodb:PutItem",
                    "dynamodb:UpdateItem",
                    "dynamodb:DeleteItem",
                ],
                Effect: "Allow",
                Resource: dynamoDBTable.arn, // Use the DynamoDB table ARN created earlier
            },
        ],
    },
});

// Attach the DynamoDB policy to the Lambda function
const lambdaRolePolicyAttachment = new aws.iam.RolePolicyAttachment("lambdaRolePolicy", {
    policyArn: dynamoDBPolicy.arn,
    role: lambdaRole.name,
});

// Define your environment variables
const lambdaEnvironment: { [key: string]: pulumi.Input<string> } = {
    // GOOGLE_STORAGE_ACCESS_KEY: serviceAccountKey.privateKey,
    // GOOGLE_STORAGE_SECRET_KEY: serviceAccountKey.publicKey,
    // GOOGLE_STORAGE_BUCKET: gcsBucket.name,
    MAILGUN_API_KEY: mailgunApiKey,
    MAILGUN_DOMAIN: mailgunDomain,
    MAILGUN_SENDER_EMAIL: mailgunSenderEmail,
    // DYNAMODB_TABLE_NAME: dynamoDBTable.name,
};

// Create an AWS Lambda function
const lambdaFunction = new aws.lambda.Function("my-lambda-function", {
    runtime: "nodejs14.x",
    handler: "index.handler",
    timeout: 10,
    role: lambdaRole.arn,
    code: new pulumi.asset.AssetArchive({
        ".": new pulumi.asset.FileArchive("../serverless"),
    }),
    environment: { variables: lambdaEnvironment },
});

// Export the security group ID
export const securityGroupId = appSecurityGroup.id;
export const internetGatewayId = internetGateway.id;
export const publicRouteTableId = publicRouteTable.id;
export const privateRouteTableId = privateRouteTable.id;
// Export the public IP of the instance
export const publicIp = ec2Instance.publicIp;
// Export the rds security group ID
export const rdsSecurityGroupId = rdsSecurityGroup.id;
// Export Auto Scaling Group details
export const autoScalingGroupName = autoScalingGroup.name;
export const autoScalingGroupDesiredCapacity = autoScalingGroup.desiredCapacity;
export const autoScalingGroupMinSize = autoScalingGroup.minSize;
export const autoScalingGroupMaxSize = autoScalingGroup.maxSize;
// // Export the DNS record information for reference
// export const domainRecordName = domainRecord.name;
// export const domainRecordType = domainRecord.type;
// export const domainRecordValue = pulumi.output(domainRecord.aliases).apply(aliases => (aliases && aliases.length > 0) ? aliases[0].name : undefined);
// Export the GCS bucket name, Service Account ID, and Access Keys
export const gcsBucketName = gcsBucket.name;
export const serviceAccountId = serviceAccount.accountId;
export const serviceAccountKeyId = serviceAccountKey.id;
export const serviceAccountEmail = serviceAccount.email;
// Export the Lambda function ARN
export const lambdaFunctionArn = lambdaFunction.arn;
// Export DynamoDB table name
export const dynamoDBTableName = dynamoDBTable.name;
// Export the Lambda Role ARN
export const lambdaRoleArn = lambdaRole.arn;

