import { createApp, ref, onMounted, watch, computed } from "vue";
import Multiselect from 'vue-multiselect';

const { electronApi } = window;

const app = createApp({
    setup() {
        onMounted(() => {
            startdate.value = new Date(new Date().getTime() - (31 * 24 * 60 * 60 * 1000)).toISOString().substring(0, 10);
            enddate.value = new Date().toISOString().substring(0, 10);            
            readsetting();       
            if(settings.value.authorization==='cli') {
                fetchOrgList();                
            }     
        });
        const selectedsidebarnav = ref('home');
        const interval = ref('Daily');
        const selectedeventtype = ref([]);        
        const startdate = ref();
        const enddate = ref();
        const authorizationoptionlist = {'cli': 'Salesforce CLI', 'unamepass': 'Username - Password', 'token': 'Access Token'};
        const eventtypelist = ['ApexCallout', 'ApexExecution', 'ApexRestApi', 'ApexSoap', 'ApexTrigger', 'ApexUnexpectedException', 'API', 'ApiTotalUsage', 'AsyncReportRun', 'AuraRequest', 'BulkApi', 'BulkApi2', 'ChangeSetOperation', 'ConcurrentLongRunningApexLimit', 'Console', 'ContentDistribution', 'ContentDocumentLink', 'ContentTransfer', 'ContinuationCallout', 'CorsViolation', 'Dashboard', 'DocumentAttachmentDownloads', 'ExternalCrossOrgCallout', 'ExternalCustomApexCallout', 'ExternalDataSourceCallout', 'ExternalODataCallout', 'FlowExecution', 'HostnameRedirects', 'InsecureExternalAssets', 'KnowledgeArticleView', 'LightningError', 'LightningInteraction', 'LightningLogger', 'LightningPageView', 'LightningPerformance', 'Login', 'LoginAs', 'Logout', 'MetadataApiOperation', 'MultiBlockReport', 'NamedCredential', 'OneCommerceUsage', 'PackageInstall', 'PlatformEncryption', 'QueuedExecution', 'Report', 'ReportExport', 'RestApi', 'Sandbox', 'Search', 'SearchClick', 'Sites', 'TimeBasedWorkflow', 'TransactionSecurity', 'UITracking', 'URI', 'VisualforceRequest', 'WaveChange', 'WaveDownload', 'WaveInteraction', 'WavePerformance'];
        const settings = ref({
            seperatefolder: false,
            outputfolder: null,
            authorization: null,
            selectedorg: null,
            username: null,
            password: null,
            loginurl: null,
            accesstoken: null,
            instanceurl: null,
            storecreds: ref(false),
            orglist: []
        })
        const fileprogress = ref({
            totalfiles: 0,
            filesdownloaded: 0,
            status: 0  // 0=not started, 1=started, 2=inprogress, 3=complete, 4=cancelled, 5=incomplete
        })

        const orgdetails = computed(() => {
            if(settings.value.orglist && settings.value.orglist.length>0) {
                let templist = settings.value.orglist.filter((org) => {
                    return org.username===settings.value.selectedorg;
                });
                //console.log(templist)
                if(templist) return templist[0];
            }
            return null;
        });

        const progressRate = computed(() => {
            if(fileprogress.value.totalfiles){
                return Math.min(fileprogress.value.filesdownloaded / fileprogress.value.totalfiles, 1);
            }
            return 0;
        });

        watch(settings, () => {            
            savesettings();
        },
        { deep: true });
        
        function savesettings() {
            //console.log(settings.value);
            const tosave = {...settings.value};
            if(!settings.value.storecreds) {
                //tosave.selectedorg = null;
                delete tosave.username;
                delete tosave.password;
                //tosave.loginurl = null;
                delete tosave.accesstoken;
                //tosave.instanceurl = null;
            }
            if(electronApi) {
                electronApi.savesettings(JSON.stringify(tosave, null, 2));
            }
        }
        
        async function readsetting() {  
            if(!electronApi) return;
            const result = await electronApi.readsettings();
            if(result) settings.value = result;
        }

        async function downloadlogs() {            
            if(!electronApi) return;
            if(!startdate.value) {
                alert("Please select From date"); return;
            }
            if(!enddate.value) {
                alert("Please select To date"); return;
            }
            if(!settings.value.outputfolder) {
                alert("Please specify the Output Folder"); return;
            }

            var data = {
                interval: interval.value,
                eventType: selectedeventtype.value ? selectedeventtype.value.toString() : '',
                startDate: startdate.value,
                endDate: enddate.value,
                outputFolder: settings.value.outputfolder,
                seperatefolder: settings.value.seperatefolder
            };

            switch(settings.value.authorization) {
                case 'cli':
                    if(settings.value.selectedorg) { data.org = settings.value.selectedorg; }
                    else { alert("Please select valid org for sf cli in settings"); return; }                     
                    break;
                case 'unamepass':
                    if(settings.value.username && settings.value.password && settings.value.loginurl) { data.username = settings.value.username; data.password = settings.value.password; data.loginurl = settings.value.loginurl; }
                    else { alert("Please provide Username, Password and login url in settings"); return;}                     
                    break;
                case 'token':
                    if(settings.value.accesstoken && settings.value.instanceurl) { data.accesstoken = settings.value.accesstoken; data.instanceurl = settings.value.instanceurl; }
                    else { alert("Please provide Access token and Instance url in settings"); return;}                    
                    break;
                default:
                    alert("Please select valid authorization in settings"); return;
            }
            fileprogress.value.status = 1;
            await electronApi.downloadeventlogs(data);
        }

        async function fetchOrgList(event) {
            if (!electronApi) return;
            var elem;
            if(event) {
                elem = event.target.tagName==='SPAN' ? event.target : event.target.children[0];
                elem.classList.add('rotating');
            }
            try{
                const orglist = await electronApi.getorglist();
                if(orglist) {
                    settings.value.orglist = [];
                    for(let org of orglist){
                        settings.value.orglist.push({username: org.username, alias: org.alias});
                    }
                }
            } catch(err){                 
                alert('Org list fetch failed.');
                console.error(err);                 
            } finally {
                if(elem) elem.classList.remove('rotating');
            }           
        }

        async function selectFolder() {
            if (!electronApi) return;
            try{
                const folderpath = await electronApi.selectfolder();
                settings.value.outputfolder = folderpath;
            } catch(err) {           
                console.error(err);                 
            } 
        }

        async function canceldownload() {
            if (!electronApi) return;
            try{
                electronApi.canceldownload();
            } catch(err) {           
                console.error(err);                 
            } 
        }

        if(electronApi){
            electronApi.filesfound((event, data) => {
                if(data){
                    fileprogress.value.totalfiles = data;
                    fileprogress.value.status = 2;
                }
            });
            electronApi.filedownloadupdate((event) => { 
                fileprogress.value.filesdownloaded = fileprogress.value.filesdownloaded+1;
            });
            electronApi.filedownloadcomplete((event) => {
                fileprogress.value.totalfiles = 0;
                fileprogress.value.status = 3;
                fileprogress.value.filesdownloaded = 0;
            });
            electronApi.downloadcancelled((event) => {
                fileprogress.value.totalfiles = 0;
                fileprogress.value.status = 4;
                fileprogress.value.filesdownloaded = 0;
            });
            electronApi.downloadincomplete((event) => {
                fileprogress.value.totalfiles = 0;
                fileprogress.value.status = 5;
                fileprogress.value.filesdownloaded = 0;
            });
        }   

        return {
            selectedsidebarnav, settings, selectedeventtype, interval, startdate, enddate, eventtypelist, 
            orgdetails, fileprogress, progressRate, authorizationoptionlist,
            downloadlogs, fetchOrgList, selectFolder, canceldownload
        };
    },
});
app.config.errorHandler = (err) => {
    console.log(err);
};
app.component('multiselect', Multiselect)
app.mount("#app");

