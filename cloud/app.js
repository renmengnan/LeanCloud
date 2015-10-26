var AV = require('leanengine');

var APP_ID = 'mleo7onuqcxdzwkr0vppy6h9'; // your app id
var APP_KEY = 'ozux1r2348rvc5pb3o8gjjtl'; // your app key
var MASTER_KEY = 'a0h3w9iilx000ee75c5o64el'; // your app master key

AV.initialize(APP_ID, APP_KEY, MASTER_KEY);
var express = require('express');
var app = express();
var Mailgun = require('mailgun').Mailgun;
var util = require('util');
var expressLayouts = require('express-ejs-layouts');
var moment = require('moment');
var _ = require('underscore');
var fs = require('fs');
var avosExpressHttpsRedirect = require('avos-express-https-redirect');
var crypto = require('crypto');
var avosExpressCookieSession = require('avos-express-cookie-session');
var nodeExcel = require('excel-export');


var admin = require('cloud/madmin.js');
var login = require('cloud/login.js');
var mticket = require('cloud/mticket.js');
var mlog = require('cloud/mlog.js');
var muser = require('cloud/muser.js');
var mutil = require('cloud/mutil.js');
var config = require('cloud/config.js');
var _s = require('underscore.string');

// App全局配置
if (__production) {
    app.set('views', 'cloud/views');    
} else {
    app.set('views', 'cloud/views');
}

app.set('view engine', 'ejs');        // 设置template引擎
app.use(avosExpressHttpsRedirect());
app.use(express.bodyParser());        // 读取请求body的中间件
app.use(express.cookieParser(config.cookieParserSalt));
app.use(avosExpressCookieSession({ 
    cookie: { 
        maxAge: 3600000 
    }, 
    fetchUser: true
}));
app.use(expressLayouts);
app.use(login.clientTokenParser());
app.use(app.router);
//app.use(login.clientTokenParser());

var todo_status = 0;
var processing_status = 1;
var done_status = 2;

var open_content = 1;
var secret_content = 0;

var mailgunKey = config.mailGunKey;
var mg = new Mailgun(mailgunKey);

var slackUrl = config.slackUrl;
var anonymousCid = login.anonymousCid;
var Ticket = AV.Object.extend('Ticket');
var Thread = AV.Object.extend('Thread');
var adminPrefix = 'AVOS Cloud -- ';
var type2showMap = {
    "consult": "咨询流程",
    'new': '新品处理流程',
    'cancelOrders': '退货处理流程',
    'complain': '投诉流程',
    'check': '订单查重流程',
    'noCar': '未分车订单处理流程',
    'visit': '订单评价回访流程',
    'firstVisit': '首单回访流程'
};
var sourceType = {
    'wxcrowd': '微信群',
    'wechat': '微信平台',
    'System': '系统后台',
    'tel400': '400电话',
    'cgwyapp': 'app',
    'other': '其他'
};
// console.log(Ticket+"/////////93");

function renderStatus(status) {
    switch (status) {
        case 0:
            return '等待处理';
        case 1:
            return '已回复';
        case 2:
            return '完成';
        default:
            return '未知状态';
    }
}

var renderError = mutil.renderError;
var renderErrorFn = mutil.renderErrorFn;
var renderForbidden = mlog.renderForbidden;
var renderInfo = mutil.renderInfo;

function checkAdmin(req, res, next) {
    var cid = req.cid;
    var isAdmin = req.admin;
    if (isAdmin === false) {
        renderForbidden(res);
        return;
    }
    next();
}

function saveFileThen(req, f) {
    if (req.files == null) {
        f();
        return;
    }
    var attachmentFile = req.files.attachment;
    if (attachmentFile && attachmentFile.name !== '') {
        fs.readFile(attachmentFile.path, function (err, data) {
            if (err) {
                return f();
            }
            //var base64Data = data.toString('base64');
            var theFile = new AV.File(attachmentFile.name, data);
            theFile.save().then(function (theFile) {
                f(theFile);
            }, function (err) {
                f();
            });
        });
    } else {
        f();
    }
}

function attachmentUrl(obj) {
    var attachment = obj.get('attachment');
    if (attachment) {
        return '<p><a href="' + attachment.url() + '" target="_blank" title="查看附件"><img src="' + attachment.url() + '"></a></p>';
    }
}

function getTicketId(t) {
    var id = t.get('tid');
    if (id) {
        return id;
    } else {
        return -1;
    }
}

//统计平均时间显示格式
function transformTime(averagetime) {
    var result = '';
    //ms -> s
    averagetime = averagetime / 1000;
    if (averagetime > 60) {
        //ms -> s
        averagetime = averagetime / 60;
        if (averagetime > 60) {
            var hour = averagetime / 60;
            averagetime = averagetime % 60;
            result = hour.toFixed(0) + ' 小时 ' + averagetime.toFixed(0) + ' 分钟';
        } else {
            result = averagetime.toFixed(0) + ' 分钟';
        }
    } else {
        result = averagetime.toFixed(0) + ' 秒';
    }
    return result;
}

function transformSearchTicket(t) {
    return {
        username: t.get('username'),
        id: t.objectId,
        tid: t.tid,
        ticket_id: t.tid,
        title: t.title,
        type: type2showMap[t.type],
        stype: sourceType[t.stype],
        req: t.req,
        followUser: t.followUser,
        followTel: t.followTel,
        consultTel: t.consultTel,
        consultUser: t.consultUser,
        restaurantID: t.restaurantID,
        restaurantName: t.restaurantName,
        restaurantReceiver: t.restaurantReceiver,
        restaurantTel: t.restaurantTel,
        orderId: t.orderId,
        createdAt: moment(t.createdAt).format('YYYY-MM-DD HH:mm:ss'),
        createdAtUnix: moment(t.createdAt).valueOf()
    };
}

function formatTime(t) {
    var date = moment(t).fromNow();
    var cleanDate = '<span class="form-cell-date">' + moment(t).format('YYYY-MM-DD') + '</span> <span class="form-cell-time">' + moment(t).format('HH:mm:ss') + '</span>';
    var time = moment(t).tz('Asia/Shanghai');
    console.log('toString', time.toString());
    console.log('getHours', time.hours())
    return date;
}

function formatTimeLong(t) {
    // var time = moment(t).tz('Asia/Shanghai');
    // console.log('toString', time.format('YYYY-MM-DD HH:mm:ss'));
    // console.log('getHours', time.hours())
    var date = moment(t).format('YYYY-MM-DD HH:mm:ss');
    return date;
}

function transformTicket(t) {
    // console.log(t.createdAt)
    var rawStatus = t.get('status');
    var open = secret_content;
    if (t.get('open') == open_content) {
        open = open_content;
    }
    var type = type2showMap[t.get('type')];
    if (type == undefined) {
        type = '未知';
    }
    var stype = sourceType[t.get('stype')];
    if (stype == undefined) {
        stype = '未知';
    }
    var consultTel = t.get('consultTel');
    if (consultTel == undefined) {
        consultTel = '未填写咨询人手机';
    }
    var followUser = t.get('followUser');
    if (followUser == undefined) {
        followUser = '未选取跟进人';
    }
    var followTel = t.get('followTel');
    if (followTel == undefined) {
        followTel = '未填写跟进人手机';
    }
    var consultUser = t.get('consultUser');
    if (consultUser == undefined) {
        consultUser = '未选取咨询人';
    }
    var restaurantID = t.get('restaurantID');
    if (restaurantID == undefined) {
        restaurantID = '未关联餐馆';
    }
    var restaurantName = t.get('restaurantName');
    if (restaurantName == undefined) {
        restaurantName = '未关联餐馆';
    }
    var restaurantTel = t.get('restaurantTel');
    if (restaurantTel == undefined) {
        restaurantTel = '未关联餐馆';
    }
    var restaurantReceiver = t.get('restaurantReceiver');
    if (restaurantReceiver == undefined) {
        restaurantReceiver = '未关联餐馆';
    }
    var orderId = t.get('orderId');
    if (orderId == undefined) {
        orderId = '未关联订单';
    }
    return {
        username: t.get('username'),
        id: t.id,
        ticket_id: getTicketId(t),
        title: t.get('title'),
        type: type,
        stype: stype,
        req: t.get('req'),
        followUser: followUser,
        followTel: followTel,
        consultUser: consultUser,
        consultTel: consultTel,
        restaurantName: restaurantName,
        restaurantReceiver: restaurantReceiver,
        restaurantTel: restaurantTel,
        restaurantID: restaurantID,
        orderId: orderId,
        content: t.get('content'),
        status: renderStatus(rawStatus),
        rawStatus: rawStatus,
        cid: t.get('cid'),
        attachment: attachmentUrl(t),
        createdAt: formatTime(t.createdAt),
        createdAtLong: formatTimeLong(t.createdAt),
        createdAtUnix: moment(t.createdAt).valueOf(),
        open: open
    };
}


function transformThread(t) {
    var user = t.get('user') || 'Anonymous';
    return {
        id: t.id,
        cid: t.get('cid'),
        content: t.get('content'),
        user: user,
        attachment: attachmentUrl(t),
        open: t.get('open'),
        createdAt: moment(t.createdAt).fromNow(),
        createdAtLong: moment(t.createdAt).format('YYYY-MM-DD HH:mm:ss')
    };
}

function genAdminTicketLink(ticket) {
    return config.hostUrl + '/ticket/tickets/' + ticket.id + '/threads';
}

function generateAdminReplyLink(ticket) {
    var link = genAdminTicketLink(ticket);
    return _s.sprintf('<p><a href="%s">Click Here</a> for details</p>', link);
}

function genSlackLink(ticket) {
    var link = genAdminTicketLink(ticket);
    return _s.sprintf('\n<%s|Click here for detail! >', link);
}

function sendEmail(ticket, subject, text, email) {
    var type = ticket.get('type');
    admin.findEmailsByType(type).then(function (emails) {
        var to;
        if (email) {
            to = email;
        } else {
            if (emails) {
                to = emails.join(',');
            }
        }
        if (__production && to) {
            mg.sendRaw(_s.sprintf('AVOS Cloud Ticket System <%s>', config.emailHost),
                [to],
                    'From:' + config.emailHost +
                    '\nTo: ' + to +
                    '\nContent-Type: text/html; charset=utf-8' +
                    '\nSubject: ' + subject +
                    '\n\n' + text,
                function (err) {
                    if (err) {
                        console.log(err);
                    }
                });
        } else {
            mlog.log(text + 'email= ' + to);
        }
    }, mutil.logErrorFn());
}

function transformNotification(n) {
    return {
        message: n.get('message'),
        link: n.get('link'),
        createdAt: n.createdAt.getTime()
    };
}

function addNotify(link, cid, msg) {
    console.log(link + ' ' + cid);
    var n = new AV.Object('TicketNotification');
    n.set('cid', cid);
    n.set('link', link);
    if (msg) {
        n.set('message', msg);
    }
    n.save().then(function () {
    }, mutil.logErrorFn());
}

app.get('/exportExcels', function(req, res){
    var data = req.query.data;
        data = JSON.parse(data);
    // console.log(data.username==undefined);
    var query = new AV.Query('Ticket');
    // console.log(req.body);
    if( data.type != '' ){
        query.equalTo("type", data.type);
    }
    if( data.sourceType != '' ){
        query.equalTo("stype", data.sourceType);
    }
    if( data.stateType != '请选择-状态' ){
        if( data.stateType == 0){
            query.equalTo("status", 0);
            query.notEqualTo("followUser", "");
        } else if( data.stateType == 3 ){
            query.equalTo("status", 0);
            query.equalTo("followUser", "");
        } else if( data.stateType == 1 ){
            query.equalTo("status", 1);
        } else if( data.stateType == 2 ){
            query.equalTo("status", 2);
        }
        
    }
    if( data.restaurantID != '' ){
        query.equalTo("restaurantID", data.restaurantID);
    }
    if( data.restaurantName != '' ){
        query.equalTo("restaurantName", data.restaurantName);
    }
    if( data.consultUser != '' ){
        query.equalTo("consultUser", data.consultUser);
    }
    if( data.consultTel != '' ){
        query.equalTo("consultTel", data.consultTel);
    }
    if( data.orderId != '' ){
        query.equalTo("orderId", data.orderId);
    }
    if( data.followUser != '' && data.followUser != undefined){
        query.equalTo("followUser", data.followUser);
    }
    if( data.username != '' && data.username != undefined){
        query.equalTo("username", data.username);
    }
    if( data.startTime != '' ){
        var st = data.startTime;
        var sDate= new Date(Date.parse(st.replace(/-/g, "/")));
        // myDate = myDate.getFullYear()+"-"+(myDate.getMonth()+1)+"-"+myDate.getDate();
        // console.log(myDate)
        query.greaterThan("createdAt", sDate);
        if( data.endTime != '' ) {
            var et = data.endTime;
            var eDate= new Date(Date.parse(et.replace(/-/g, "/")));
            query.lessThan("createdAt", eDate);
        }
    }
    query.descending('createdAt');
    query.find().then(function (tickets) {
        tickets = tickets || [];
        tickets = _.map(tickets, transformTicket);
        console.log(tickets.length);
        if(tickets!=""){
            var excelInfo = tickets;
            // console.log(excelInfo[0].req)

            var conf ={};
            // uncomment it for style example  
            conf.stylesXmlFile = "cloud/styles.xml";

            conf.cols = [
                {caption:'流程类型', type:'string'},
                {caption:'咨询人', type:'string'},
                {caption:'咨询人手机', type:'string'},
                {caption:'餐馆名称', type:'string'},
                {caption:'餐馆联系人', type:'string'},
                {caption:'餐馆联系人电话', type:'string'},
                {caption:'关联餐馆ID', type:'string'},
                {caption:'关联订单ID', type:'string'},
                {caption:'待跟进人', type:'string'},
                {caption:'待跟进人手机', type:'string'},
                {caption:'问题来源', type:'string'}
            ];
            conf.rows = [];
            for(var i = 0; i < excelInfo.length; i++){
                conf.rows[i]= [
                    excelInfo[i].type, 
                    excelInfo[i].consultUser, 
                    excelInfo[i].consultTel, 
                    excelInfo[i].restaurantName, 
                    excelInfo[i].restaurantReceiver, 
                    excelInfo[i].restaurantTel, 
                    excelInfo[i].restaurantID, 
                    excelInfo[i].orderId, 
                    excelInfo[i].followUser, 
                    excelInfo[i].followTel,
                    excelInfo[i].stype
                ]; 
                if(excelInfo[i].type=="咨询流程"){
                    if(i==0){
                        conf.cols.push({caption:'咨询类别', type:'string'});
                        conf.cols.push({caption:'咨询处理结果', type:'string'});
                        conf.cols.push({caption:'咨询流程备注', type:'string'});
                    }
                    conf.rows[i].push(excelInfo[i].req.consultType);
                    conf.rows[i].push(excelInfo[i].req.consultResult);
                    conf.rows[i].push(excelInfo[i].req.consultRemarks);
                }else if(excelInfo[i].type=="新品处理流程") {
                    if(i==0){
                        conf.cols.push({caption:'新品流程分类', type:'string'});
                        conf.cols.push({caption:'新品流程状态', type:'string'});
                        conf.cols.push({caption:'市场有无货', type:'string'});
                        conf.cols.push({caption:'所属市场', type:'string'});
                        conf.cols.push({caption:'新品参考名称', type:'string'});
                        conf.cols.push({caption:'参考价格', type:'string'});
                        conf.cols.push({caption:'SKUID', type:'string'});
                        conf.cols.push({caption:'产品名称', type:'string'});
                        conf.cols.push({caption:'规格', type:'string'});
                        conf.cols.push({caption:'分类', type:'string'});
                        conf.cols.push({caption:'建议售价', type:'string'});
                        conf.cols.push({caption:'市场价', type:'string'});
                        conf.cols.push({caption:'供货商', type:'string'});
                        conf.cols.push({caption:'线上更改情况', type:'string'});
                        conf.cols.push({caption:'未更改原因', type:'string'});
                        conf.cols.push({caption:'新品流程备注', type:'string'});
                    }
                    conf.rows[i].push(excelInfo[i].req.newStype);
                    conf.rows[i].push(excelInfo[i].req.newType);
                    conf.rows[i].push(excelInfo[i].req.newIsno);
                    conf.rows[i].push(excelInfo[i].req.newMarket);
                    conf.rows[i].push(excelInfo[i].req.newReName);
                    conf.rows[i].push(excelInfo[i].req.newRePrice);
                    conf.rows[i].push(excelInfo[i].req.newSkuid);
                    conf.rows[i].push(excelInfo[i].req.newProName);
                    conf.rows[i].push(excelInfo[i].req.newSpecifications);
                    conf.rows[i].push(excelInfo[i].req.newClassification);
                    conf.rows[i].push(excelInfo[i].req.newRecommended);
                    conf.rows[i].push(excelInfo[i].req.newMarketVal);
                    conf.rows[i].push(excelInfo[i].req.newSupplier);
                    conf.rows[i].push(excelInfo[i].req.newOnlineChange);
                    conf.rows[i].push(excelInfo[i].req.newNoChange);
                    conf.rows[i].push(excelInfo[i].req.newProcess);
                } else if(excelInfo[i].type=="退货处理流程"){
                    if(i==0){
                        conf.cols.push({caption:'商户地址', type:'string'});
                        conf.cols.push({caption:'销售员', type:'string'});
                        conf.cols.push({caption:'订单产品', type:'string'});
                        conf.cols.push({caption:'订购数量', type:'string'});
                        conf.cols.push({caption:'退换数量', type:'string'});
                        conf.cols.push({caption:'退款金额', type:'string'});
                        conf.cols.push({caption:'送货车辆', type:'string'});
                        conf.cols.push({caption:'送货日期', type:'string'});
                        conf.cols.push({caption:'退换原因', type:'string'});
                        conf.cols.push({caption:'处理意见', type:'string'});
                        conf.cols.push({caption:'计划退货时间', type:'string'});
                        conf.cols.push({caption:'实际退货时间', type:'string'});
                        conf.cols.push({caption:'退货状态', type:'string'});
                        conf.cols.push({caption:'已退货产品处理', type:'string'});
                        conf.cols.push({caption:'已退货供应商处理', type:'string'});
                        conf.cols.push({caption:'退换货备注', type:'string'});
                        conf.cols.push({caption:'回访记录', type:'string'});
                    }
                    conf.rows[i].push(excelInfo[i].req.cancelAddress);
                    conf.rows[i].push(excelInfo[i].req.cancelSalesperson);
                    conf.rows[i].push(excelInfo[i].req.cancelProduct);
                    conf.rows[i].push(excelInfo[i].req.cancelQuantity);
                    conf.rows[i].push(excelInfo[i].req.cancelNum);
                    conf.rows[i].push(excelInfo[i].req.cancelAmount);
                    conf.rows[i].push(excelInfo[i].req.cancelCar);
                    conf.rows[i].push(excelInfo[i].req.DeliveryDate);
                    conf.rows[i].push(excelInfo[i].req.cancelReason);
                    conf.rows[i].push(excelInfo[i].req.cancelSuggestion);
                    conf.rows[i].push(excelInfo[i].req.planDeliveryDate);
                    conf.rows[i].push(excelInfo[i].req.ActualDeliveryDate);
                    conf.rows[i].push(excelInfo[i].req.cancelType);
                    conf.rows[i].push(excelInfo[i].req.cancelHandleType);
                    conf.rows[i].push(excelInfo[i].req.supplier);
                    conf.rows[i].push(excelInfo[i].req.cancelRemarks);
                    conf.rows[i].push(excelInfo[i].req.visitRecord);
                } else if(excelInfo[i].type=="投诉流程"){
                    if(i==0){
                        conf.cols.push({caption:'投诉类别', type:'string'});
                        conf.cols.push({caption:'投诉部门', type:'string'});
                        conf.cols.push({caption:'投诉处理过程', type:'string'});
                        conf.cols.push({caption:'投诉事项', type:'string'});
                        conf.cols.push({caption:'期望的处理方法', type:'string'});
                        conf.cols.push({caption:'处理描述', type:'string'});
                    }
                    conf.rows[i].push(excelInfo[i].req.complainType);
                    conf.rows[i].push(excelInfo[i].req.complainDepartmentType);
                    conf.rows[i].push(excelInfo[i].req.complainProcess);
                    conf.rows[i].push(excelInfo[i].req.complains);
                    conf.rows[i].push(excelInfo[i].req.complainExpected);
                    conf.rows[i].push(excelInfo[i].req.complainDescription);
                } else if(excelInfo[i].type=="订单查重流程"){
                    if(i==0){
                        conf.cols.push({caption:'处理过程', type:'string'});
                        conf.cols.push({caption:'处理描述', type:'string'});
                    }
                    conf.rows[i].push(excelInfo[i].req.checkProcess);
                    conf.rows[i].push(excelInfo[i].req.checkDescription);
                } else if(excelInfo[i].type=="未分车订单处理流程"){
                    if(i==0){
                        conf.cols.push({caption:'未分车原因', type:'string'});
                        conf.cols.push({caption:'未分单处理过程描述', type:'string'});
                        conf.cols.push({caption:'处理描述', type:'string'});
                    }
                    conf.rows[i].push(excelInfo[i].req.noCarReason);
                    conf.rows[i].push(excelInfo[i].req.noCarType);
                    conf.rows[i].push(excelInfo[i].req.noCarDescription);
                } else if(excelInfo[i].type=="订单评价回访流程"){
                    if(i==0){
                        conf.cols.push({caption:'下单时间', type:'string'});
                        conf.cols.push({caption:'退货原因', type:'string'});
                        conf.cols.push({caption:'司机名称', type:'string'});
                        conf.cols.push({caption:'商品质量', type:'string'});
                        conf.cols.push({caption:'送货速度', type:'string'});
                        conf.cols.push({caption:'订单评价处理描述', type:'string'});
                        conf.cols.push({caption:'配送评价', type:'string'});
                        conf.cols.push({caption:'其他信息', type:'string'});
                    }
                    conf.rows[i].push(excelInfo[i].req.visitSingleTime);
                    conf.rows[i].push(excelInfo[i].req.visitCname);
                    conf.rows[i].push(excelInfo[i].req.visitDriverName);
                    conf.rows[i].push(excelInfo[i].req.visitQuality);
                    conf.rows[i].push(excelInfo[i].req.visitSpeed);
                    conf.rows[i].push(excelInfo[i].req.visitDescription);
                    conf.rows[i].push(excelInfo[i].req.visitEvaluation);
                    conf.rows[i].push(excelInfo[i].req.visitOtherInfo);
                } else if(excelInfo[i].type=="首单回访流程"){
                    if(i==0){
                        conf.cols.push({caption:'下订单方式', type:'string'});
                        conf.cols.push({caption:'原来采购方式', type:'string'});
                        conf.cols.push({caption:'信息通知', type:'string'});
                        conf.cols.push({caption:'对产品质量评价', type:'string'});
                        conf.cols.push({caption:'对地推员工评价', type:'string'});
                        conf.cols.push({caption:'对送货司机的评价', type:'string'});
                        conf.cols.push({caption:'其他意见和建议', type:'string'});
                        conf.cols.push({caption:'回访备注', type:'string'});
                    }
                    conf.rows[i].push(excelInfo[i].req.fvType);
                    conf.rows[i].push(excelInfo[i].req.purchaseType);
                    conf.rows[i].push(excelInfo[i].req.fvInfo);
                    conf.rows[i].push(excelInfo[i].req.fvEvaluation);
                    conf.rows[i].push(excelInfo[i].req.staffEvaluation);
                    conf.rows[i].push(excelInfo[i].req.driverEvaluation);
                    conf.rows[i].push(excelInfo[i].req.fvComments);
                    conf.rows[i].push(excelInfo[i].req.fvRemarks);
                }   
            }
            // console.log(conf.rows)
            var result = nodeExcel.execute(conf);
            // console.log(type2showMap[excelInfo.type]);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats');
            res.setHeader("Content-Disposition", "attachment; filename=" + "Report.xlsx");
            res.end(result, 'binary');

        }

    })
});
//使用express路由API服务/hello的http GET请求
app.get('/tickets', function (req, res) {
    var token = req.token;
    var cid = req.cid;
    var isAdmin = req.admin;
    // console.log(req);
    if (isAdmin) {
        //enter admin page.
        res.redirect('ticket/admin/tickets');
    } else {
        var query = new AV.Query('Ticket');
        query.ascending('status');
        query.descending('createdAt');
        query.equalTo('cid', cid);
        query.find().then(function (tickets) {
            tickets = tickets || [];
            tickets = _.map(tickets, transformTicket);
            // console.log(tickets);
            res.render('list', {
                tickets: tickets,
                searchData: null,
                token: token
            });
        }, mutil.renderErrorFn(res));
    }
});

app.get('/history', function (req, res) {
    var cid = req.cid;
    var isAdmin = req.admin;
    if (isAdmin) {
        res.redirect('ticket/admin/history');
    } else {
        var skip = req.query.skip;
        if (skip == null) {
            skip = 0;
        }
        var limit = 100;
        var type = req.query.type;
        var query = new AV.Query("Ticket");
        // query.equalTo('status', done_status); //工单状态，0：正在处理；2：完成；
        if (type != null) {
            query.equalTo('type', type);
        }
        query.limit(limit);
        query.skip(skip);
        query.descending('createdAt');
        query.find().then(function (tickets) {
            tickets = tickets || [];
            tickets = _.map(tickets, transformTicket);
            var back = -1;
            var next = -1;
            if (parseInt(skip) > 0) {
                back = parseInt(skip) - parseInt(limit);
            }
            if (tickets.length == limit) {
                next = parseInt(skip) + parseInt(limit);
            }
            // console.log(tickets);
            res.render('history', {
                tickets: tickets, 
                searchData: null,
                back: back, 
                next: next, 
                type: type
            });
        }, renderErrorFn(res));
    }
});
app.get('/stocks', function (req, res) {
    var cid = req.cid;
    var isAdmin = req.admin;
    if (isAdmin) {
        res.redirect('ticket/admin/history');
    } else {
        var skip = req.query.skip;
        if (skip == null) {
            skip = 0;
        }
        var limit = 100;
        var type = req.query.type;
        var query = new AV.Query("Ticket");
        // query.equalTo('status', done_status); //工单状态，0：正在处理；2：完成；
        if (type != null) {
            query.equalTo('type', type);
        }
        query.limit(limit);
        query.skip(skip);
        query.descending('createdAt');
        query.find().then(function (tickets) {
            tickets = tickets || [];
            tickets = _.map(tickets, transformTicket);
            var back = -1;
            var next = -1;
            if (parseInt(skip) > 0) {
                back = parseInt(skip) - parseInt(limit);
            }
            if (tickets.length == limit) {
                next = parseInt(skip) + parseInt(limit);
            }
            // console.log(tickets);
            res.render('stocks', {
                tickets: tickets, 
                searchData: null,
                back: back, 
                next: next, 
                type: type
            });
        }, renderErrorFn(res));
    }
});
app.post('/stocks/search', function (req, res) {
    var cid = req.cid;
    var isAdmin = req.admin;
    var status = req.query.status;
    // console.log(req);
    var searchData = req.body;
    var skip = req.query.skip;
    if (skip == null) {
        skip = 0;
    }
    var limit = 100;
    var type = req.query.type;
    var query = new AV.Query('Ticket');
    // console.log(req.body);
    if( req.body.type != '' ){
        query.equalTo("type", req.body.type);
    }
    if( req.body.sourceType != '' ){
        query.equalTo("stype", req.body.sourceType);
    }
    if( req.body.stateType != '请选择-状态' ){
        if( req.body.stateType == 0){
            query.equalTo("status", 0);
            query.notEqualTo("followUser", "");
        } else if( req.body.stateType == 3 ){
            query.equalTo("status", 0);
            query.equalTo("followUser", "");
        } else if( req.body.stateType == 1 ){
            query.equalTo("status", 1);
        } else if( req.body.stateType == 2 ){
            query.equalTo("status", 2);
        }
        
    }
    if( req.body.restaurantID != '' ){
        query.equalTo("restaurantID", req.body.restaurantID);
    }
    if( req.body.restaurantName != '' ){
        query.equalTo("restaurantName", req.body.restaurantName);
    }
    if( req.body.consultUser != '' ){
        query.equalTo("consultUser", req.body.consultUser);
    }
    if( req.body.consultTel != '' ){
        query.equalTo("consultTel", req.body.consultTel);
    }
    if( req.body.orderId != '' ){
        query.equalTo("orderId", req.body.orderId);
    }
    if( req.body.username != '' ){
        query.equalTo("username", req.body.username);
    }
    if( req.body.startTime != '' ){
        var st = req.body.startTime;
        var sDate= new Date(Date.parse(st.replace(/-/g, "/")));
        // myDate = myDate.getFullYear()+"-"+(myDate.getMonth()+1)+"-"+myDate.getDate();
        // console.log(myDate)
        query.greaterThan("createdAt", sDate);
        if( req.body.endTime != '' ) {
            var et = req.body.endTime;
            var eDate= new Date(Date.parse(et.replace(/-/g, "/")));
            query.lessThan("createdAt", eDate);
        }
    }
    query.limit(limit);
    query.skip(skip);
    query.descending('createdAt');
    query.find().then(function (tickets) {
        // console.log(tickets);
        tickets = tickets || [];
        tickets = _.map(tickets, transformTicket);
        var back = -1;
        var next = -1;
        if (parseInt(skip) > 0) {
            back = parseInt(skip) - parseInt(limit);
        }
        if (tickets.length == limit) {
            next = parseInt(skip) + parseInt(limit);
        }
        // console.log(tickets);
        res.render('stocks', {
            tickets: tickets, 
            searchData: searchData,
            back: back, 
            next: next, 
            type: type
        });
    }, renderErrorFn(res));
});
app.post('/history/search', function (req, res) {
    var cid = req.cid;
    var isAdmin = req.admin;
    var status = req.query.status;
    // console.log(req);
    var skip = req.query.skip;
    var searchData = req.body;
    if (skip == null) {
        skip = 0;
    }
    var limit = 100;
    var type = req.query.type;
    var query = new AV.Query('Ticket');
    // console.log(req.body);
    if( req.body.type != '' ){
        query.equalTo("type", req.body.type);
    }
    if( req.body.sourceType != '' ){
        query.equalTo("stype", req.body.sourceType);
    }
    if( req.body.stateType != '请选择-状态' ){
        if( req.body.stateType == 0){
            query.equalTo("status", 0);
            query.notEqualTo("followUser", "");
        } else if( req.body.stateType == 3 ){
            query.equalTo("status", 0);
            query.equalTo("followUser", "");
        } else if( req.body.stateType == 1 ){
            query.equalTo("status", 1);
        } else if( req.body.stateType == 2 ){
            query.equalTo("status", 2);
        }
        
    }
    if( req.body.restaurantID != '' ){
        query.equalTo("restaurantID", req.body.restaurantID);
    }
    if( req.body.restaurantName != '' ){
        query.equalTo("restaurantName", req.body.restaurantName);
    }
    if( req.body.consultUser != '' ){
        query.equalTo("consultUser", req.body.consultUser);
    }
    if( req.body.consultTel != '' ){
        query.equalTo("consultTel", req.body.consultTel);
    }
    if( req.body.orderId != '' ){
        query.equalTo("orderId", req.body.orderId);
    }
    if( req.body.username != '' ){
        query.equalTo("username", req.body.username);
    }
    if( req.body.startTime != '' ){
        var st = req.body.startTime;
        var sDate= new Date(Date.parse(st.replace(/-/g, "/")));
        // myDate = myDate.getFullYear()+"-"+(myDate.getMonth()+1)+"-"+myDate.getDate();
        // console.log(myDate)
        query.greaterThan("createdAt", sDate);
        if( req.body.endTime != '' ) {
            var et = req.body.endTime;
            var eDate= new Date(Date.parse(et.replace(/-/g, "/")));
            query.lessThan("createdAt", eDate);
        }
    }
    query.limit(limit);
    query.skip(skip);
    query.descending('createdAt');
    query.find().then(function (tickets) {
        // console.log(tickets);
        tickets = tickets || [];
        tickets = _.map(tickets, transformTicket);
        var back = -1;
        var next = -1;
        if (parseInt(skip) > 0) {
            back = parseInt(skip) - parseInt(limit);
        }
        if (tickets.length == limit) {
            next = parseInt(skip) + parseInt(limit);
        }
        // console.log(tickets);
        res.render('history', {
            tickets: tickets,
            searchData: searchData, 
            back: back, 
            next: next, 
            type: type
        });
    }, renderErrorFn(res));
});
app.post('/tickets/search', function (req, res) {
    var cid = req.cid;
    var isAdmin = req.admin;
    var status = req.query.status;
    var searchData = req.body;
    // console.log(req);
    var skip = req.query.skip;
    if (skip == null) {
        skip = 0;
    }
    var limit = 100;
    var type = req.query.type;
    var query = new AV.Query('Ticket');
    // console.log(req.body);
    if( req.body.type != '' ){
        query.equalTo("type", req.body.type);
    }
    if( req.body.sourceType != '' ){
        query.equalTo("stype", req.body.sourceType);
    }
    if( req.body.stateType != '请选择-状态' ){
        if( req.body.stateType == 0){
            query.equalTo("status", 0);
            query.notEqualTo("followUser", "");
        } else if( req.body.stateType == 3 ){
            query.equalTo("status", 0);
            query.equalTo("followUser", "");
        } else if( req.body.stateType == 1 ){
            query.equalTo("status", 1);
        } else if( req.body.stateType == 2 ){
            query.equalTo("status", 2);
        }
        
    }
    if( req.body.restaurantID != '' ){
        query.equalTo("restaurantID", req.body.restaurantID);
    }
    if( req.body.restaurantName != '' ){
        query.equalTo("restaurantName", req.body.restaurantName);
    }
    if( req.body.consultUser != '' ){
        query.equalTo("consultUser", req.body.consultUser);
    }
    if( req.body.consultTel != '' ){
        query.equalTo("consultTel", req.body.consultTel);
    }
    if( req.body.orderId != '' ){
        query.equalTo("orderId", req.body.orderId);
    }
    if( req.body.followUser != '' ){
        query.equalTo("followUser", req.body.followUser);
    }
    if( req.body.startTime != '' ){
        var st = req.body.startTime;
        var sDate= new Date(Date.parse(st.replace(/-/g, "/")));
        // myDate = myDate.getFullYear()+"-"+(myDate.getMonth()+1)+"-"+myDate.getDate();
        // console.log(myDate)
        query.greaterThan("createdAt", sDate);
        if( req.body.endTime != '' ) {
            var et = req.body.endTime;
            var eDate= new Date(Date.parse(et.replace(/-/g, "/")));
            query.lessThan("createdAt", eDate);
        }
    }
    query.limit(limit);
    query.skip(skip);
    query.descending('createdAt');
    query.find().then(function (tickets) {
        // console.log(tickets);
        tickets = tickets || [];
        tickets = _.map(tickets, transformTicket);
        var back = -1;
        var next = -1;
        if (parseInt(skip) > 0) {
            back = parseInt(skip) - parseInt(limit);
        }
        if (tickets.length == limit) {
            next = parseInt(skip) + parseInt(limit);
        }
        // console.log(tickets);
        res.render('list', {
            tickets: tickets,
            searchData: searchData, 
            back: back, 
            next: next, 
            type: type
        });
    }, renderErrorFn(res));
});
app.get('/notifications', function (req, res) {
    var token = req.token;
    var cid = req.cid;
    var lastDate = req.query.lastDate;
    var query = new AV.Query('TicketNotification');
    query.equalTo('cid', cid);
    if (lastDate) {
        query.greaterThan('createdAt', new Date(parseInt(lastDate)));
    }
    query.descending('createdAt');
    query.find().then(function (results) {
        results = _.map(results, transformNotification);
        res.send({ 
            results: results
        });
    }, renderErrorFn(res));
});

app.get('/tickets/new', function (req, res) {
    var token = req.token;
    var client = req.client;
    // console.log(req.query);
    res.render('new', {
        token: token, 
        client: client,
        data: null,
        restaurant: null,
        tel: null
    });
});

app.get('/admin/tickets', function (req, res) {
    var token = req.token;
    var client = req.client;
    var email = client.email;
    var skip = req.query.skip;
    var status = req.query.status;
    if (skip == null) {
        skip = 0;
    }
    var limit = 100;
    admin.findAdmins().then(function (admins) {
        admins = _.map(admins, admin.transformAdmin);
        var thisAdmin;
        _.each(admins, function (admin) {
            //mlog.log('this admin='+admin.email);
            //mlog.log('email='+email);
            if (admin.email == email) {
                thisAdmin = admin;
            }
        });
        //mlog.log('this '+thisAdmin.types);
        var query = new AV.Query('Ticket');
        if (!status) {
            query.lessThan('status', done_status);
            query.limit(limit);
        }
        else {
            query.equalTo('status', parseInt(status));
        }

        query.skip(skip);
        query.descending('createdAt');
        query.find().then(function (tickets) {
            tickets = tickets || [];
            //归属Ticket
            if (status) {
                var filters = _.filter(tickets, function (t) {
                    //mlog.log(t.get('type')+' ticket type');
                    if (thisAdmin && thisAdmin.types.indexOf(t.get('type')) != -1) {
                        return true;
                    } else {
                        return false;
                    }
                });
                if (thisAdmin) {
                    tickets = filters;
                }
            }
            tickets = _.map(tickets, transformTicket);

            var back = -1;
            var next = -1;

            if (parseInt(skip) > 0) {
                back = parseInt(skip) - parseInt(limit);
            }
            if (tickets.length == limit) {
                next = parseInt(skip) + parseInt(limit);
            }
            if (status == null) {
                status = "";
            }
            res.render('admin_list', {
                tickets: tickets, 
                token: token, 
                email: email,
                status: status, 
                back: back, 
                next: next 
            });
        }, renderErrorFn(res));
    }, renderErrorFn(res));
});

app.get('/admin/history', function (req, res) {
    var token = req.token;
    var limit = 100;
    var type = req.query.type;
    var skip = req.query.skip;
    if (skip == null) {
        skip = 0;
    }
    var searchcontent = req.query.searchcontent;
    cosnole.log(searchcontent);
    var query = new AV.Query('Ticket');
    query.equalTo('status', done_status);
    if (type != null) {
        query.equalTo('type', type);
    }
    if (searchcontent != null) {
        AV.Cloud.httpRequest({
            url: 'https://cn.avoscloud.com/1/search/select?limit=200&clazz=Ticket&q=' + searchcontent,
            headers: {
                'Content-Type': 'application/json',
                'X-AVOSCloud-Application-Id': config.applicationId,
                'X-AVOSCloud-Application-Key': config.applicationKey,
            },
            success: function (httpResponse) {
                var back = -1;
                var next = -1;
                tickets = JSON.parse(httpResponse.text).results || [];
                tickets = _.map(tickets, transformSearchTicket);
                //renderError(res, tickets);
                res.render('admin_history', {
                    tickets: tickets, 
                    back: back, 
                    next: next, 
                    type: type
                });
                //console.log(httpResponse.text);
            },
            error: function (httpResponse) {
                renderError(res, 'Search error.' + searchcontent);
                //console.error('Request failed with response code ' + httpResponse.status);
            }
        });
    } else {
        query.limit(limit);
        query.descending('createdAt');
        query.skip(skip);
        query.find().then(function (tickets) {
            tickets = tickets || [];
            //renderError(res, tickets);
            tickets = _.map(tickets, transformTicket);
            var back = -1;
            var next = -1;
            if (parseInt(skip) > 0)
                back = parseInt(skip) - parseInt(limit);
            if (tickets.length == limit)
                next = parseInt(skip) + parseInt(limit);
            res.render('admin_history', {tickets: tickets, token: token, back: back, next: next, type: type});
        }, renderErrorFn(res));
    }
});

function isThisWeek(timeStr) {
    var now = new Date();
    diffDays = moment(now.toLocaleDateString()).diff(moment(timeStr), 'days');
    return diffDays < 8;
}

function getStatisticsEachType(admins, ticketThreads) {
    var week = [];
    var allhistory = [];
    var type2name = {};
    for (var type in type2showMap) {
        type2name[type] = [];
        admins.forEach(function(admin) {
            if (admin.types && admin.types.indexOf(type) >= 0) {
                type2name[type].push(admin.username);
            }
        });
    }

    for (var type in type2showMap) {
        var tts = _.filter(ticketThreads, function (tt) {
            var t = tt.ticket;
            return t.get('status') == done_status && t.get('type') == type;
        });
        tts = tts || [];
        var replynum = 0;
        var averagetime = 0;
        var showtype = '';
        var adminname = '';
        var ticketnum = tts.length;
        var currentTicketNum = 0;

        var weekTicketNum = 0;
        var weekReplyNum = 0;
        var weekAverageTime = 0;
        for (var i in tts) {
            t = tts[i].ticket;
            var ticketType = t.get('type');
            showtype = type2showMap[ticketType];
            adminname = type2name[ticketType];
            var inweek = false;
            var creatdAt = t.createdAt;
            var isInWeek = isThisWeek(creatdAt);
            if (isInWeek) {
                inweek = true;
                weekTicketNum += 1;
            }
            var threads = tts[i].threads;
            var currentthreadnum = 0;
            threads = threads || [];
            _.each(threads, function (th) {
                replynum += 1;
                if (inweek) {
                    weekReplyNum += 1;
                }
                currentthreadnum += 1;
                if (currentthreadnum == 1) {
                    averagetime += moment(th.createdAt).diff(moment(t.createdAt));
                    if (inweek) {
                        weekAverageTime += moment(th.createdAt).diff(moment(t.createdAt));
                    }
                }
            });

            currentTicketNum += 1;
            if (currentTicketNum == ticketnum) {
                if (ticketnum > 0) {
                    averagetime = averagetime / ticketnum;
                }
                if (weekTicketNum > 0) {
                    weekAverageTime = weekAverageTime / weekTicketNum;
                }

                var data = {
                    type: showtype,
                    admin: adminname,
                    ticketnum: ticketnum,
                    replynum: replynum,
                    averageTime: transformTime(averagetime),
                    averageTimeUnix: averagetime
                };
                allhistory.push(data);

                data = {
                    type: showtype,
                    admin: adminname,
                    ticketnum: weekTicketNum,
                    replynum: weekReplyNum,
                    averageTime: transformTime(weekAverageTime),
                    averageTimeUnix: weekAverageTime
                };
                week.push(data);

            }
        }

    }
    return {
        week: week, 
        allhistory: allhistory
    };
}

function getStatisticsEachAdmin(admins, ticketThreads) {
    admins.forEach(function (admin) {
        for (var i in ticketThreads) {
            var tt = ticketThreads[i];
            var find = false;
            tt.threads.forEach(function (thread) {
                if (admin.cid == thread.get('cid')) {
                    find = true;
                    if (isThisWeek(thread.createdAt)) {
                        admin.weekReplyNum ++;
                    }
                    admin.allReplyNum ++;
                }
            });
            if (find) {
                if (isThisWeek(tt.ticket.createdAt)) {
                    admin.weekTicketNum ++;
                }
                admin.allTicketNum ++;
            }
        }
    });
}

app.get('/admin/statistics', function (req, res) {
    var token = req.token;
    admin.findAdmins().then(function (admins) {
        admins = _.map(admins, admin.transformAdmin);
        var allTickets;
        var allThreads;
        var promises = [];
        promises.push(admin.findAll('Ticket').then(function (tickets) {
            allTickets = tickets;
        }));
        promises.push(admin.findAll('Thread').then(function (threads) {
            allThreads = threads;
        }));
        //mlog.log('find all');
        AV.Promise.when(promises).then(function () {
            var ticketThreads = [];
            var used = new Array(allThreads.length);
            for (var i = 0; i < used.length; i++) {
                used[i] = false;
            }
            allTickets.forEach(function (ticket) {
                var threads = [];
                for (var i = 0; i < allThreads.length; i++) {
                    var thread = allThreads[i];
                    if (used[i] == false && thread.get('ticket').id == ticket.id) {
                        used[i] = true;
                        threads.push(thread);
                    }
                }
                ticketThreads.push({ticket: ticket, threads: threads});
            });
            var __ret = getStatisticsEachType(admins, ticketThreads);
            getStatisticsEachAdmin(admins, ticketThreads);
            //mlog.log(admins);
            res.render('admin_statistics', {token: token, week: __ret.week, allhistory: __ret.allhistory, admins: admins});
        }, mutil.renderErrorFn(res));
    }, mutil.renderErrorFn(res));
});

function judgeVisibleForOne(open, isAdmin, cid, ticketCid) {
    if (open == open_content || isAdmin || ticketCid == anonymousCid || cid == ticketCid) {
        return true;
    } else {
        return false;
    }
}

function judgeVisible(threads, isAdmin, cid, ticketCid) {
    _.each(threads, function (thread) {
        thread.visible = judgeVisibleForOne(thread.open, isAdmin, cid, ticketCid);
    });
}

function findMyLastOpen(admin, ticket, threads) {
    var i = threads.length - 1;
    while (i >= 0) {
        var th = threads[i];
        if (admin) {
            if (th.user.indexOf('AVOS Cloud') != -1) {
                return th.open;
            }
        } else {
            if (th.user.indexOf('AVOS Cloud') == -1) {
                return th.open;
            }
        }
        i --;
    }
    if (admin) {
        return open_content;
    } else {
        return ticket.open;
    }
}

function genQQLink(isAdmin, ticketCid, visitCid, threads) {
    var p = new AV.Promise();
    if (isAdmin) {
        muser.findUserById(ticketCid).then(function (c) {
            if (c && c.qq) {
                p.resolve('/clients/' + ticketCid);
            } else {
                p.resolve(null);
            }
        }, mutil.rejectFn(p));
    } else {
        if (ticketCid == visitCid) {
            admin.findCleanAdmins().then(function (admins) {
                for (var i = threads.length - 1; i >= 0; i--) {
                    var thread = threads[i];
                    for (var j = 0; j < admins.length; j++) {
                        var admin = admins[j];
                        mlog.log('cid=' + admin.cid + '    ' + thread.cid);
                        if (thread.cid == admin.cid) {
                            p.resolve('/engineers/' + admin.id);
                            return;
                        }
                    }
                }
                p.resolve();
            }, mutil.rejectFn(p));
        } else {
            p.resolve();
        }
    }
    return p;
}

app.get('/tickets/:id/threads', function (req, res) {
    var ticketId = req.params.id;
    var token = req.token;
    var cid = req.cid;
    var query = new AV.Query('Thread');
    query.ascending('createdAt');
    query.equalTo('ticket', AV.Object.createWithoutData('Ticket', ticketId));
    query.find().then(function (threads) {
        var ticket = AV.Object.createWithoutData('Ticket', ticketId);
        ticket.fetch().then(function (ticket) {
            // if (isTicketEmpty(ticket) == false) {
                ticket = transformTicket(ticket);
                threads = _.map(threads, transformThread);
                var isAdmin = req.admin;
                var open = ticket.open;
                ticket.visible = judgeVisibleForOne(open, isAdmin, cid, ticket.cid);
                judgeVisible(threads, isAdmin, cid, ticket.cid);
                var lastOpen = findMyLastOpen(isAdmin, ticket, threads);
                genQQLink(isAdmin, ticket.cid, cid, threads).then(function (qqLink) {
                    mlog.log('qqlink' + qqLink);
                    // console.log(ticket);
                    res.render('edit', { 
                        ticket: ticket, 
                        token: token, 
                        threads: threads,
                        admin: isAdmin, 
                        cid: cid, 
                        lastOpen: lastOpen, 
                        qqLink: qqLink
                    });
                }, mutil.renderErrorFn(res));
            // } else {
                // renderError(res, '找不到工单，该工单可能已经被删除');
            // }
        }, renderErrorFn(res));
    }, renderErrorFn(res));
});
app.get('/tickets/:id/newthreads', function (req, res) {
    var ticketId = req.params.id;
    var token = req.token;
    var cid = req.cid;
    var query = new AV.Query('Thread');
    query.ascending('createdAt');
    query.equalTo('ticket', AV.Object.createWithoutData('Ticket', ticketId));
    query.find().then(function (threads) {
        var ticket = AV.Object.createWithoutData('Ticket', ticketId);
        ticket.fetch().then(function (ticket) {
            // if (isTicketEmpty(ticket) == false) {
                ticket = transformTicket(ticket);
                threads = _.map(threads, transformThread);
                var isAdmin = req.admin;
                var open = ticket.open;
                ticket.visible = judgeVisibleForOne(open, isAdmin, cid, ticket.cid);
                judgeVisible(threads, isAdmin, cid, ticket.cid);
                var lastOpen = findMyLastOpen(isAdmin, ticket, threads);
                genQQLink(isAdmin, ticket.cid, cid, threads).then(function (qqLink) {
                    mlog.log('qqlink' + qqLink);
                    res.render('newedit', { 
                        ticket: ticket, 
                        token: token, 
                        threads: threads,
                        admin: isAdmin, 
                        cid: cid, 
                        lastOpen: lastOpen, 
                        qqLink: qqLink
                    });
                }, mutil.renderErrorFn(res));
            // } else {
                // renderError(res, '找不到工单，该工单可能已经被删除');
            // }
        }, renderErrorFn(res));
    }, renderErrorFn(res));
});
var closeMsg = '关闭了 AVOS Cloud 上的工单，如果还有问题请及时联系。';
function sendClientEmail(ticket, html) {
    var ticketSeq = getTicketId(ticket);
    var link = 'http://ticket.avosapps.com/tickets/' + ticket.id + '/threads';
    html = html + '<br/><p>请直接 <a href="' + link + '" target="_blank">点击这里</a> 进入 AVOS Cloud 技术支持系统回复。</p>' +
        '<p>谢谢，AVOS Cloud Team</p>';
    sendEmail(ticket, 'AVOS Cloud 技术支持工单' + ticketSeq + ' 更新', html, ticket.get('client_email'));
}

function sendCloseEmail(ticket) {
    sendClientEmail(ticket, closeMsg);
}

function truncateContent(content) {
    var len = content.length;
    if (len <= 20) {
        return content;
    } else {
        return content.substring(0, 20) + '...';
    }
}

function isTicketEmpty(ticket) {
    return !ticket || ticket.get('title') == null;
}

app.post('/tickets/:id/threads', function (req, res) {
    var cid = req.cid;
    var client = req.client;
    var token = req.token;
    var ticketId = req.params.id;
    var ticket = AV.Object.createWithoutData('Ticket', ticketId);
    ticket.fetch().then(function (ticket) {
        // if (isTicketEmpty(ticket) == false) {
            //864 is administrator's client id
            var isAdmin=req.admin;
            // if (ticket.get('cid') != cid && !isAdmin) {
            //     renderError(res, '非法的客户端，请不要回复他人的工单');
            // } else {
                if (ticket.get('status') == done_status) {
                } else {
                    var ticketSeq = getTicketId(ticket);
                    saveFileThen(req, function (attachment) {
                        var thread = new AV.Object('Thread');
                        if (attachment) {
                            thread.set('attachment', attachment);
                        }
                        thread.set('ticket', AV.Object.createWithoutData('Ticket', ticketId));
                        var username = client.username;
                        var close = req.body.close;
                        var secret = req.body.secret;
                        var reqs = req.body;
                        mlog.log('secret=' + secret);
                        isAdmin = req.admin;
                        if (isAdmin) {
                            username = adminPrefix + username;
                        }
                        thread.set('user', username);
                        thread.set('cid', cid);
                        thread.set('req', reqs);
                        thread.set('type',req.body.type);
                        thread.set('consultUser',req.body.consultUser);
                        thread.set('restaurantID',req.body.restaurantID);
                        thread.set('restaurantName',req.body.restaurantName);
                        thread.set('restaurantReceiver',req.body.restaurantReceiver);
                        thread.set('restaurantTel',req.body.restaurantTel);
                        thread.set('orderId',req.body.orderId);
                        thread.set('followUser',req.body.followUser);
                        thread.set('type',req.body.type);
                        thread.set('stype',req.body.sourceType);
                        thread.set('consultTel',req.body.consultTel);
                        thread.set('followTel',req.body.followTel);
                        var content = req.body.content;
                        if (isAdmin) {
                            var html;
                            if (close == '1') {
                                if (content == null || content == '') {
                                    content = closeMsg;
                                }
                                html = content;
                                ticket.set('status', done_status);
                                ticket.save();
                            } else {
                                html = '<p>' + req.client.username +
                                    '回复到：</p> <p><pre> ' + content + ' </pre></p>';
                                ticket.set('status', processing_status);
                                ticket.set("req",reqs);
                                ticket.set('type',req.body.type);
                                ticket.set('consultUser',req.body.consultUser);
                                ticket.set('restaurantID',req.body.restaurantID);
                                ticket.set('restaurantName',req.body.restaurantName);
                                ticket.set('restaurantReceiver',req.body.restaurantReceiver);
                                ticket.set('restaurantTel',req.body.restaurantTel);
                                ticket.set('orderId',req.body.orderId);
                                ticket.set('followUser',req.body.followUser);
                                ticket.set('type',req.body.type);
                                ticket.set('stype',req.body.sourceType);
                                ticket.set('consultTel',req.body.consultTel);
                                ticket.set('followTel',req.body.followTel);
                                ticket.set('content',req.body.content);
                                ticket.save();
                            }
                            if (ticket.get('status') == done_status) {
                                notifyTicketToChat(ticket, '', '管理员关闭了工单。');
                            }
                            sendClientEmail(ticket, html, ticketSeq);
                            addNotify('http://cgwy.avosapps.com/tickets/' + ticket.id + '/threads', cid);
                        } else {
                            if (close == '1') {
                                if (content == null || content == '') {
                                    content = closeMsg;
                                }
                                ticket.set('status', done_status);
                                ticket.set("req",reqs);
                                ticket.set('type',req.body.type);
                                ticket.set('consultUser',req.body.consultUser);
                                ticket.set('restaurantID',req.body.restaurantID);
                                ticket.set('restaurantName',req.body.restaurantName);
                                ticket.set('restaurantReceiver',req.body.restaurantReceiver);
                                ticket.set('restaurantTel',req.body.restaurantTel);
                                ticket.set('orderId',req.body.orderId);
                                ticket.set('followUser',req.body.followUser);
                                ticket.set('type',req.body.type);
                                ticket.set('stype',req.body.sourceType);
                                ticket.set('consultTel',req.body.consultTel);
                                ticket.set('followTel',req.body.followTel);
                                ticket.set('content',req.body.content);
                                ticket.save();
                            } else {
                                //update client token and status
                                // console.log(reqs);
                                // console.log(reqs.consultResult);
                                html = '<p>' + req.client.username +
                                    '回复到：</p> <p><pre> ' + content + ' </pre></p>';
                                if( client.username != ticket.attributes.username ){
                                    ticket.set('status', processing_status);
                                    ticket.set("req",reqs);
                                    ticket.set('type',req.body.type);
                                    ticket.set('consultUser',req.body.consultUser);
                                    ticket.set('restaurantID',req.body.restaurantID);
                                    ticket.set('restaurantName',req.body.restaurantName);
                                    ticket.set('restaurantReceiver',req.body.restaurantReceiver);
                                    ticket.set('restaurantTel',req.body.restaurantTel);
                                    ticket.set('orderId',req.body.orderId);
                                    ticket.set('followUser',req.body.followUser);
                                    ticket.set('type',req.body.type);
                                    ticket.set('stype',req.body.sourceType);
                                    ticket.set('consultTel',req.body.consultTel);
                                    ticket.set('followTel',req.body.followTel);
                                    ticket.set('content',req.body.content);
                                    ticket.save();
                                } else {
                                    ticket.set("req",reqs);
                                    ticket.set('type',req.body.type);
                                    ticket.set('consultUser',req.body.consultUser);
                                    ticket.set('restaurantID',req.body.restaurantID);
                                    ticket.set('restaurantName',req.body.restaurantName);
                                    ticket.set('restaurantReceiver',req.body.restaurantReceiver);
                                    ticket.set('restaurantTel',req.body.restaurantTel);
                                    ticket.set('orderId',req.body.orderId);
                                    ticket.set('followUser',req.body.followUser);
                                    ticket.set('type',req.body.type);
                                    ticket.set('stype',req.body.sourceType);
                                    ticket.set('consultTel',req.body.consultTel);
                                    ticket.set('followTel',req.body.followTel);
                                    ticket.save();
                                }
                                
                            }
                            var text = '<p>Client: client.username </p><p>Title:     <pre>' + ticket.get('title') + '</pre></p><p>Reply:    <pre>' + content + '</pre></p>';
                            text = text + generateAdminReplyLink(ticket);
                            sendEmail(ticket, 'New reply thread', text);
                            notifyTicketToChat(ticket, content, '工单新回复！');
                        }
                        thread.set('content', content);
                        if (secret) {
                            thread.set('open', secret_content);
                        } else {
                            thread.set('open', open_content);
                        }
                        thread.save().then(function () {
                            res.redirect('ticket/tickets');
                        }, renderErrorFn(res));
                    });
                }
            // }
        // } else {
        //     renderError(res, '找不到工单');
        // }
    }, renderErrorFn(res));
});
app.post('/tickets/:id/newthreads', function (req, res) {
    var cid = req.cid;
    var client = req.client;
    var token = req.token;
    var ticketId = req.params.id;
    var ticket = AV.Object.createWithoutData('Ticket', ticketId);
    // console.log(ticketId);
    var query = new AV.Query('Ticket');
        query.get(ticketId, {
            success: function(post) {
              // 成功，回调中可以取得这个 Post 对象的一个实例，然后就可以修改它了
              post.set('title',req.body.title);
              post.set('consultUser',req.body.consultUser);
              post.set('restaurantID',req.body.restaurantID);
              post.set('orderId',req.body.orderId);
              post.set('followUser',req.body.followUser);
              post.set('type',req.body.type);
              post.set('stype',req.body.sourceType);
              post.set('consultTel',req.body.consultTel);
              post.set('followTel',req.body.followTel);
              post.set('content',req.body.content);
              post.save().then(function(){
                res.redirect('ticket/tickets');
              });
              // console.log(post);
            },
            error: function(object, error) {
              // 失败了.
              console.log(object);
            }
        });
});
function notifySlack(text, type) {
    if (__production == false) {
        mlog.log('type=' + type);
        mlog.log(text);
        return;
    }
    AV.Cloud.httpRequest({
        method: 'POST',
        timeout: 15000,
        url: slackUrl,
        body: JSON.stringify({
            username: type,
            text: text,
            icon_url: 'https://cn.avoscloud.com/images/static/press/Logo%20Avatar.png'
        }),
        error: function (httpResponse) {
            console.error('Request failed with response    ' + httpResponse.text);
        }
    });
}

function validateEmail(email) {
    var re = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(email);
}

function notifyTicketToChat(ticket, content, info) {
    var part = '';
    if (content && content != '') {
        part = '        内容：' + truncateContent(content);
    }
    var hipChatText = info + '     ' + ticket.get('title') + part;
    var type = type2showMap[ticket.get('type')];
    notifySlack(hipChatText + genSlackLink(ticket), type);
}

function createTicket(res, req, restaurantTel, restaurantReceiver, restaurantName, consultTel, followTel, consultUser, restaurantID, orderId, followUser, sourceTypetype, token, client, attachment, title, type, content, secret, then) {
    mticket.incTicketNReturnOrigin().then(function (n) {
        var ticket = new AV.Object('Ticket');
        if (attachment) {
            ticket.set('attachment', attachment);
        }
        mlog.log('secret=' + secret);
        if (secret) {
            ticket.set('open', secret_content);
        } else {
            ticket.set('open', open_content);
        }
        // console.log(client.username);
        ticket.set('username', client.username);
        ticket.set('req', req);
        ticket.set('cid', client.id);
        ticket.set('client_email', client.email);
        ticket.set('type', type);
        ticket.set('followUser', followUser);
        ticket.set('consultUser', consultUser);
        ticket.set('restaurantID', restaurantID);
        ticket.set('restaurantName', restaurantName);
        ticket.set('restaurantReceiver', restaurantReceiver);
        ticket.set('restaurantTel', restaurantTel);
        ticket.set('orderId', orderId);
        ticket.set('stype', sourceTypetype);
        ticket.set('consultTel', consultTel);
        ticket.set('followTel', followTel);
        ticket.set('client_token', token);
        ticket.set('status', todo_status);
        ticket.set('title', title);
        ticket.set('content', content);
        ticket.set('tid', n);
        ticket.save().then(function (ticket) {
            var text = '<p>Client:    ' + client.username + '</p><p> Type:    ' + type + '</p><p> Title:    <pre>' + title + '</pre></p><p>Content:    <pre>' + content + '</pre></p>';
            text += generateAdminReplyLink(ticket);
            sendEmail(ticket, 'New ticket', text);
            var info = '新的工单！';
            notifyTicketToChat(ticket, content, info);
            then(ticket);
        }, renderErrorFn(res));
    });
}

app.post('/tickets', function (req, res) {
    var token = req.token;
    var cid = req.cid;
    var client = req.client;
    // mlog.log('req title111' + client.username);
    // if (!client.email || !validateEmail(client.email)) {
    //     return renderError(res, '请提供有效的电子邮箱地址，方便我们将反馈通知给您。');
    // }
    saveFileThen(req, function (attachment) {
        createTicket(res, req.body, req.body.restaurantTel, req.body.restaurantReceiver, req.body.restaurantName, req.body.consultTel, req.body.followTel, req.body.consultUser, req.body.restaurantID, req.body.orderId, req.body.followUser, req.body.sourceType, token, client, attachment, req.body.title, req.body.type, req.body.content, req.body.secret, function (ticket) {
            // console.log(ticket);
            res.redirect('ticket/tickets');
        });
    });
});

function uniqTickets(ts) {
    return _.uniq(ts, false, function (item, key, a) {
        if (item == null) {
            return null;
        } else {
            return item.id;
        }
    });
}

function getAdminReplyN() {
    var q = new AV.Query(Thread);
    q.startsWith('user', 'AVOS');
    return q.count();
}

app.get('/search', function (req, res) {
    var content = req.query.content;
    if (content == null || content == '') {
        res.redirect('ticket/search?content=AVObject&page=1');
        return;
    }
    var page = req.query.page;
    if (!page) {
        page = '1';
        res.redirect('search?content=' + encodeURI(content) + '&page=1');
        return;
    }
    page = parseInt(page);
    if (page < 1) page = 1;
    var skip = (page - 1) * 10;
    var total = skip + 10;
    mlog.log('c=' + content);
    var searchContent = content;
    mlog.log('c=' + searchContent);
    getAdminReplyN().then(function (threadsN) {
        AV.Cloud.httpRequest({
            url: 'https://cn.avoscloud.com/1.1/search/select?limit=' + total + '&clazz=Ticket&q=' + searchContent,
            headers: {
                'Content-Type': 'application/json',
                'X-AVOSCloud-Application-Id': config.applicationId,
                'X-AVOSCloud-Application-Key': config.applicationKey
            },
            success: function (httpResponse) {
                var resText = httpResponse.text;
                var ticketJson = JSON.parse(resText);
                //mlog.log(ticketJson);
                var sid = ticketJson.sid;
                tickets = ticketJson.results || [];
                tickets = tickets.splice(skip);
                tickets = _.map(tickets, transformSearchTicket);
                //renderError(res, tickets);
                //res.render('search', {tickets: tickets, content:content ,threadsN:threadsN,searchPage:true});
                var url = 'https://cn.avoscloud.com/search/select/?hl=true&fl=url,title&hl.fl=title,content&' +
                    'start=' + skip + '&limit=10&wt=json&hl.alternateField=content&hl.maxAlternateFieldLength=250&q=' + searchContent;
                AV.Cloud.httpRequest({
                    url: url,
                    success: function (resp) {
                        var doc = resp.text;
                        doc = JSON.parse(doc);
                        var docs = doc.response.docs;
                        _.each(docs, function (doc) {
                            //mlog.log(doc.title);
                        });
                        var prevPage, nextPage;
                        if (page > 1) {
                            prevPage = page - 1;
                        } else {
                            prevPage = 1;
                        }
                        nextPage = page + 1;
                        res.render('search', {tickets: tickets, content: content, threadsN: threadsN,
                            searchPage: true, docs: docs, page: page, prevPage: prevPage, nextPage: nextPage});
                    },
                    error: function (err) {
                        mlog.log(err);
                        console.error('search doc error:' + httpResponse.error);
                    }
                });
            },
            error: function (httpResponse) {
                renderError(res, 'Search error.' + httpResponse);
                console.error('Request failed with response code ' + httpResponse.text);
            }
        });
    });
    //searchWithRegex(content, res);
});

app.get('/admin/detail/:id', function (req, res) {
    var id = req.params.id;
    admin.findAdminById(id).then(function (_sa) {
        sa = admin.transformAdmin(_sa);
        addTypeName(sa);
        res.render('admin_detail', {admin: sa, type2showMap: type2showMap});
    });
});

app.post('/admin/detail/:id', function (req, res) {
    var id = req.params.id;
    var type = req.body.type;

    function redirect() {
        res.redirect('ticket/admin/detail/' + id);
    }

    if (type) {
        admin.addOrDelType(id, type)
            .then(function () {
                redirect();
            });
    }
});

app.post('/tickets/:id/delete', function (req, res) {
    checkAdmin(req, res, function () {
        var id = req.params.id;
        admin.deleteTicket(id).then(function (result) {
            var tn = result[0];
            var nn = result[1];
            renderInfo(res, '同时删除了' + tn + '个消息回复与' + nn + '个消息提醒', '/tickets');
        });
    });
});

function addTypeName(admin) {
    admin.typeNames = [];
    _.each(admin.types, function (type) {
        admin.typeNames.push(type2showMap[type]);
    });
    admin.typeName = admin.typeNames.join('，');
}

app.get('/contact', function (req, res) {
    var cid = req.cid;
    var client = req.client;
    admin.findAdmins().then(function (admins) {
        admins = _.map(admins, admin.transformAdmin);
        _.each(admins, addTypeName);
        isAdmin = req.admin;
        res.render('contact', {admins: admins, isAdmin: isAdmin, client: client});
    }, mutil.renderErrorFn(res));
});

app.get('/login', function (req, res) {
    if (login.isLogin(req)) {
        res.redirect('ticket/tickets');
    } else {
        // console.log(req.query);
        res.render('login.ejs');
    }
});
app.get('/searchTel', function (req, res) {
    var data = req.query.data;
        data = JSON.parse(data);
    // console.log(data);
    var username = data.username,
        password = "111111";
    AV.Cloud.httpRequest({
        url: 'https://cn.avoscloud.com/1/users?where={"username":{"$regex":"'+ username +'"}}',
        headers: {
            'Content-Type': 'application/json',
            'X-AVOSCloud-Application-Id': config.applicationId,
            'X-AVOSCloud-Application-Key': config.applicationKey,
        },
        success: function (httpResponse) {
            var userTag = httpResponse.data.results.length;
            if( userTag == 0 ){
                var user = new AV.User();
                user.set('username', username);
                user.set('password', password);
                user.signUp(null).then(function (user) {
                    var cid = req.cid;
                    var status = req.query.status;
                    // console.log(req);
                    var skip = req.query.skip;
                    if (skip == null) {
                        skip = 0;
                    }
                    var limit = 1000;
                    // var query = new AV.Query('Ticket');
                    // console.log(req.body);
                    if( data.info.consultTel != '' && data.info.restaurantTel != '' ){
                        var restQuery = new AV.Query("Ticket");
                        var consultQuery = new AV.Query("Ticket");  
                        if( data.info.restaurantTel != '' ){
                            // query.equalTo("restaurantTel", req.body.restaurantTel);
                            var arr = [];
                            for(var i = 0; i< data.info.restaurantTel.length; i++){
                                arr.push(data.info.restaurantTel[i]);
                            }
                            restQuery.containedIn("restaurantTel",arr);
                        }
                        if( data.info.consultTel != '' ){
                            var arr = [];
                            for(var i = 0; i< data.info.consultTel.length; i++){
                                arr.push(data.info.consultTel[i]);
                            }
                            consultQuery.containedIn("consultTel",arr);
                        }
                        var query = AV.Query.or(restQuery, consultQuery);
                    } else {
                        var query = new AV.Query('Ticket');
                        // console.log(req.body);
                        
                        if( data.info.restaurantTel != '' ){
                            // query.equalTo("restaurantTel", req.body.restaurantTel);
                            var arr = [];
                            for(var i = 0; i< data.info.restaurantTel.length; i++){
                                arr.push(data.info.restaurantTel[i]);
                            }
                            query.containedIn("restaurantTel",arr);
                        }
                        if( data.info.consultTel != '' ){
                            var arr = [];
                            for(var i = 0; i< data.info.consultTel.length; i++){
                                arr.push(data.info.consultTel[i]);
                            }
                            query.containedIn("consultTel",arr);
                        }
                    }
                    
                    query.limit(limit);
                    query.skip(skip);
                    query.descending('createdAt');
                    query.find().then(function (tickets) {
                        // console.log(tickets);
                        tickets = tickets || [];
                        tickets = _.map(tickets, transformTicket);
                        var back = -1;
                        var next = -1;
                        if (parseInt(skip) > 0) {
                            back = parseInt(skip) - parseInt(limit);
                        }
                        if (tickets.length == limit) {
                            next = parseInt(skip) + parseInt(limit);
                        }
                        // console.log(tickets);
                        res.render('searchTel', {
                            tickets: tickets,
                            back: back, 
                            next: next
                        });
                    }, renderErrorFn(res));
                    
                }, function (error) {
                    renderInfo(res, util.inspect(error));
                });
            } else {
                AV.User.logIn(username, password, {
                    success: function (user) {
                        var cid = req.cid;
                        var status = req.query.status;
                        // console.log(req);
                        var skip = req.query.skip;
                        if (skip == null) {
                            skip = 0;
                        }
                        var limit = 1000;
                        // var query = new AV.Query('Ticket');
                        // console.log(req.body);
                        if( data.info.consultTel != '' && data.info.restaurantTel != '' ){
                            var restQuery = new AV.Query("Ticket");
                            var consultQuery = new AV.Query("Ticket");  
                            if( data.info.restaurantTel != '' ){
                                // query.equalTo("restaurantTel", req.body.restaurantTel);
                                var arr = [];
                                for(var i = 0; i< data.info.restaurantTel.length; i++){
                                    arr.push(data.info.restaurantTel[i]);
                                }
                                restQuery.containedIn("restaurantTel",arr);
                            }
                            if( data.info.consultTel != '' ){
                                var arr = [];
                                for(var i = 0; i< data.info.consultTel.length; i++){
                                    arr.push(data.info.consultTel[i]);
                                }
                                consultQuery.containedIn("consultTel",arr);
                            }
                            var query = AV.Query.or(restQuery, consultQuery);
                        } else {
                            var query = new AV.Query('Ticket');
                            // console.log(req.body);
                            
                            if( data.info.restaurantTel != '' ){
                                // query.equalTo("restaurantTel", req.body.restaurantTel);
                                var arr = [];
                                for(var i = 0; i< data.info.restaurantTel.length; i++){
                                    arr.push(data.info.restaurantTel[i]);
                                }
                                query.containedIn("restaurantTel",arr);
                            }
                            if( data.info.consultTel != '' ){
                                var arr = [];
                                for(var i = 0; i< data.info.consultTel.length; i++){
                                    arr.push(data.info.consultTel[i]);
                                }
                                query.containedIn("consultTel",arr);
                            }
                        }
                        
                        query.limit(limit);
                        query.skip(skip);
                        query.descending('createdAt');
                        query.find().then(function (tickets) {
                            // console.log(tickets);
                            tickets = tickets || [];
                            tickets = _.map(tickets, transformTicket);
                            var back = -1;
                            var next = -1;
                            if (parseInt(skip) > 0) {
                                back = parseInt(skip) - parseInt(limit);
                            }
                            if (tickets.length == limit) {
                                next = parseInt(skip) + parseInt(limit);
                            }
                            // console.log(tickets);
                            res.render('searchTel', {
                                tickets: tickets,
                                back: back, 
                                next: next
                            });
                        }, renderErrorFn(res));
                    }
                });
            }
            console.log(httpResponse.data.results.length);
        },
        error: function (httpResponse) {
            // renderError(res, 'Search error.');
            console.error(httpResponse);
        }
    });
});
app.get('/newTicket', function (req, res) {
    // console.log(typeof req.query.data);
    var data = req.query.data;
        data = JSON.parse(data);
    // console.log(data);
    var username = data.username,
        password = "111111";
    // var token = req.token;
    // var client = req.client;
    // res.render('new',{
    //     token: token,
    //     client: client,
    //     data: data.info
    // })
    AV.Cloud.httpRequest({
        url: 'https://cn.avoscloud.com/1/users?where={"username":{"$regex":"'+ username +'"}}',
        headers: {
            'Content-Type': 'application/json',
            'X-AVOSCloud-Application-Id': config.applicationId,
            'X-AVOSCloud-Application-Key': config.applicationKey,
        },
        success: function (httpResponse) {
            var userTag = httpResponse.data.results.length;
            if( userTag == 0 ){
                var user = new AV.User();
                user.set('username', username);
                user.set('password', password);
                user.signUp(null).then(function (user) {
                    // var data = data.info;
                    // data = JSON.stringify(data);
                    // res.redirect('ticket/tickets/new');
                    var token = req.token;
                    var client = req.client;
                    if( data.info){
                        res.render('new',{
                            token: token,
                            client: client,
                            data: data.info,
                            restaurant: null,
                            tel: null
                        })
                    } else if( data.restaurant ) {
                        res.render('new',{
                            token: token,
                            client: client,
                            data: null,
                            restaurant: data.restaurant,
                            tel: null
                        })
                    } else if( data.tel ) {
                        res.render('new',{
                            token: token,
                            client: client,
                            data: null,
                            restaurant: null,
                            tel: data.tel
                        })
                    } else {
                        res.render('new',{
                            token: token,
                            client: client,
                            data: null,
                            restaurant: null,
                            tel: null
                        })
                    }
                    
                }, function (error) {
                    renderInfo(res, util.inspect(error));
                });
            } else {
                AV.User.logIn(username, password, {
                    success: function (user) {
                        // var data = data.info;
                        // data = JSON.stringify(data);
                        // res.redirect('ticket/tickets/new');
                        var token = req.token;
                        var client = req.client;
                        if( data.info){
                            res.render('new',{
                                token: token,
                                client: client,
                                data: data.info,
                                restaurant: null,
                                tel: null
                            })
                        } else if( data.restaurant ) {
                            res.render('new',{
                                token: token,
                                client: client,
                                data: null,
                                restaurant: data.restaurant,
                                tel: null
                            })
                        } else if( data.tel ) {
                            res.render('new',{
                                token: token,
                                client: client,
                                data: null,
                                restaurant: null,
                                tel: data.tel
                            })
                        } else {
                            res.render('new',{
                                token: token,
                                client: client,
                                data: null,
                                restaurant: null,
                                tel: null
                            })
                        }
                    }
                });
            }
            console.log(httpResponse.data.results.length);
        },
        error: function (httpResponse) {
            // renderError(res, 'Search error.');
            console.error(httpResponse);
        }
    });
});
app.get('/login:id', function (req, res) {
    // console.log(req.params.id);
    var username = req.params.id,
        password = "111111";
        username = username.slice(1);
    AV.Cloud.httpRequest({
        url: 'https://cn.avoscloud.com/1/users?where={"username":{"$regex":"'+ username +'"}}',
        headers: {
            'Content-Type': 'application/json',
            'X-AVOSCloud-Application-Id': config.applicationId,
            'X-AVOSCloud-Application-Key': config.applicationKey,
        },
        success: function (httpResponse) {
            var userTag = httpResponse.data.results.length;
            if( userTag == 0 ){
                var user = new AV.User();
                user.set('username', username);
                user.set('password', password);
                user.signUp(null).then(function (user) {
                    res.redirect('ticket/tickets');
                }, function (error) {
                    renderInfo(res, util.inspect(error));
                });
            } else {
                AV.User.logIn(username, password, {
                    success: function (user) {
                        res.redirect('ticket/tickets');
                    }
                });
            }
            // console.log(httpResponse.data.results.length);
        },
        error: function (httpResponse) {
            // renderError(res, 'Search error.');
            console.error(httpResponse);
        }
    });
});
app.post('/register', function (req, res) {
    var username = req.body.username;
    var password = req.body.password;
    var email = req.body.email;
    if (username && password && email) {
        var user = new AV.User();
        user.set('username', username);
        user.set('password', password);
        user.set('email', email);
        user.signUp(null).then(function (user) {
            login.renderEmailVerify(res, email);
        }, function (error) {
            renderInfo(res, util.inspect(error));
        });
    } else {
        mutil.renderError(res, '不能为空');
    }
});

app.post('/login', function (req, res) {
    var username = req.body.username;
    var password = req.body.password;
    AV.User.logIn(username, password, {
        success: function (user) {
            res.redirect('ticket/tickets');
        },
        error: function (user, error) {
            mutil.renderError(res, error.message);
        }
    });
});

app.get('/register', function (req, res) {
    if (login.isLogin(req)) {
        res.redirect('ticket/tickets');
    } else {
        res.render('register.ejs');
    }
});

function judgeDetailVisible(isAdmin, detailCid, visistCid) {
    if (isAdmin) {
        return AV.Promise.as(isAdmin);
    }
    return login.isAdmin(detailCid).then(function (isAdminDetail) {
        if (isAdminDetail || detailCid == visistCid) {
            return AV.Promise.as(true);
        } else {
            return AV.Promise.as(false);
        }
    });
}

app.get('/clients/:id', function (req, res) {
    var cid = req.cid;
    var id = req.params.id;
    if (judgeDetailVisible(req.admin,id, cid)) {
        muser.findUserById(id).then(function (client) {
            if (client) {
                res.render('client_detail', {client: client});
            } else {
                renderInfo(res, '此用户并未建立用户信息');
            }
        }, mutil.renderErrorFn(res));
    } else {
        renderForbidden(res);
    }
});

function isAdminOrMe(isAdmin,contentId, visitId) {
    return isAdmin || contentId == visitId;
}


app.post('/clients/:id', function (req, res) {
    var cid = req.cid;
    var id = req.params.id;
    var is = isAdminOrMe(req.admin, id, cid);
    if (is) {
        muser.updateCurUser(req.body).then(function () {
            res.redirect('ticket/contact');
        }, mutil.renderErrorFn(res));
    } else {
        renderForbidden(res);
    }
});

app.get('/engineers/:id', function (req, res) {
    var id = req.params.id;
    admin.findCleanAdminById(id).then(function (admin) {
        if (admin) {
            addTypeName(admin);
            res.render('admin_open_detail', {admin: admin});
        } else {
            renderError(res, '对不起，未找到该工程师的信息。');
        }
    }, mutil.renderErrorFn(res));
});

function testFn(fn, res) {
    fn.call(this).then(function () {
        res.send('ok');
    }, mutil.renderErrorFn(res));
}

app.get('/logout', function (req, res) {
    AV.User.logOut();
    res.redirect('ticket/tickets');
});

app.get('/', function (req, res) {
    res.redirect('ticket/tickets');
});

app.get('/google', function (req, res) {
    var content = req.query.content;
    res.redirect('https://www.google.com.hk/search?q=site%3Ahttps%3A%2F%2Fticket.avosapps.com+' + content);
});

app.get('/requestEmailVerify', function (req, res) {
    var email = req.query.email;
    AV.User.requestEmailVerfiy(email).then(function () {
        mutil.renderInfo(res, '邮件已发送请查收。');
    }, mutil.renderErrorFn(res));
});

app.post('/admin',function(req,res){
    var username=req.body.username;
    admin.addOrDelAdmin(username).then(function(){
        res.redirect('ticket/contact');
    },mutil.renderErrorFn(res));
});

app.get('/test', function (req, res) {
});


//最后，必须有这行代码来使express响应http请求
app.listen({"static": {maxAge: 604800000}});
// console.log(todo_status+"//"+processing_status+"//"+done_status);
exports.todo_status = todo_status;
exports.processing_status = processing_status;
exports.done_status = done_status;
exports.sendCloseEmail = sendCloseEmail;
exports.notifyTicketToChat = notifyTicketToChat;
exports.generateAdminReplyLink = generateAdminReplyLink;
exports.transfromTime = transformTime;
